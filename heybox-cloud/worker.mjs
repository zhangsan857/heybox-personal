import { HeyboxClient } from './runtime/client.js';
import { validateConfig } from './runtime/config.js';
import { inspect, runDaily } from './runtime/tasks.js';
import { setTimeout as wait } from 'node:timers/promises';
import { ids, beijingDay, untilMidnight, pending, guardedFetch, creditedTasks, failureCode } from './policy.mjs';

export function minimalConfig(value) {
  const config = validateConfig(value);
  const result = {};
  for (const [section, keys] of Object.entries({ session: ['heybox_id', 'pkey', 'device_id', 'x_xhh_tokenid'], device: ['model', 'osVersion'], app: ['version', 'build', 'shaderVersion'] })) {
    result[section] = Object.fromEntries(keys.map(key => [key, config[section][key]]));
  }
  return result;
}

export function encodeConfig(value) {
  const encoded = Buffer.from(JSON.stringify(minimalConfig(value)), 'utf8').toString('base64');
  if (encoded.length > 45_000) throw new Error('CLOUD_CONFIG_TOO_LARGE');
  return encoded;
}

export function decodeConfig(value) {
  try {
    const encoded = String(value || '').trim();
    if (!encoded) throw new Error('CLOUD_CONFIG_MISSING');
    if (encoded.length > 45_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) throw new Error('CLOUD_CONFIG_INVALID');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw new Error('CLOUD_CONFIG_INVALID');
    return minimalConfig(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if (error.message === 'CLOUD_CONFIG_MISSING') throw error;
    throw new Error('CLOUD_CONFIG_INVALID');
  }
}

export function control(env) {
  if (env.GITHUB_REPOSITORY !== 'zhangsan857/heybox-personal' || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('CLOUD_CONTEXT_DENIED');
  if (!/^[1-9][0-9]{0,23}$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT || '')) throw new Error('CLOUD_RUN_CONTEXT_INVALID');
  const mode = env.CLOUD_MODE;
  if (!['check', 'run', 'failure-drill'].includes(mode)) throw new Error('CLOUD_MODE_INVALID');
  if (mode === 'run' && (env.CLOUD_CONFIRM !== 'RUN6' || env.HOSTED_PAUSED !== 'true')) throw new Error('CLOUD_RUN_NOT_CONFIRMED');
  return mode;
}

export function safeCode(error) {
  for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    if (/^CLOUD_[A-Z0-9_]{1,80}$/.test(current.message || '')) return current.message;
  }
  return failureCode(error).replace(/^STAGE4_/, 'CLOUD_');
}

function taskStates(snapshot) {
  const waiting = pending(snapshot);
  return Object.fromEntries(ids.map(id => [id, waiting.includes(id) ? 'waiting' : 'finish']));
}

export async function executeCloud(env, { fetchImpl = globalThis.fetch, now = Date.now, sleep, budgetMs = 600_000, progress = () => {} } = {}) {
  const mutations = Object.fromEntries(ids.map(id => [id, 0]));
  let mode = ['check', 'run', 'failure-drill'].includes(env.CLOUD_MODE) ? env.CLOUD_MODE : 'unknown', phase = 'control';
  const started = now();
  const report = { schema: 1, runId: String(env.GITHUB_RUN_ID || ''), attempt: String(env.GITHUB_RUN_ATTEMPT || ''), day: beijingDay(started),
    mode, simulated: false, ok: false, startedAt: new Date(started).toISOString(), mutations, executed: [], skipped: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('CLOUD_TIME_LIMIT')), budgetMs);
  const checkpoint = () => {
    if (controller.signal.aborted) throw new Error('CLOUD_TIME_LIMIT');
    if (beijingDay(now()) !== report.day) throw new Error('CLOUD_DAY_CHANGED');
  };
  try {
    mode = control(env); report.mode = mode;
    if (mode === 'failure-drill') {
      report.simulated = true;
      throw new Error('CLOUD_DRILL_AUTH_EXPIRED');
    }
    phase = 'config';
    const config = decodeConfig(env.HEYBOX_CONFIG_B64);
    const makeClient = write => new HeyboxClient(config, { fetchImpl: guardedFetch({ write, day: report.day, now, signal: controller.signal, checkpoint, fetchImpl,
      phase: () => phase, onMutation: id => { mutations[id]++; progress({ phase, mutations: { ...mutations } }); } }) });
    phase = 'inspect';
    const before = await inspect(makeClient(false), config.session.heybox_id, now);
    checkpoint();
    if (mode === 'check') {
      return { ...report, ok: true, marker: 'CLOUD_CHECK_OK', finishedAt: new Date(now()).toISOString(), states: taskStates(before),
        allComplete: pending(before).length === 0, pendingCount: pending(before).length };
    }
    const canWrite = pending(before).length > 0;
    if (canWrite && untilMidnight(now()) < 600_000) throw new Error('CLOUD_WINDOW_TOO_SHORT');
    const result = await runDaily(makeClient(canWrite), config.session.heybox_id, { now,
      checkpoint: async () => checkpoint(), sleep: sleep || (ms => wait(ms, undefined, { signal: controller.signal })), log: () => {},
      onStage: value => { phase = value; progress({ phase, mutations: { ...mutations } }); },
    });
    phase = 'readback';
    const after = await inspect(makeClient(false), config.session.heybox_id, now);
    checkpoint();
    const executed = creditedTasks(result, after, mutations);
    return { ...report, ok: true, marker: executed.length ? 'CLOUD_RUN_VERIFIED' : 'CLOUD_RUN_SKIPPED', finishedAt: new Date(now()).toISOString(),
      states: taskStates(after), allComplete: true, pendingCount: 0, executed, skipped: ids.filter(id => result.execution[id] === 'skipped'),
      expDelta: result.expDelta ?? null, coinDelta: result.coinDelta, batteryDelta: result.batteryDelta ?? null };
  } catch (error) {
    const code = report.simulated ? 'APP_AUTH_EXPIRED' : controller.signal.aborted ? 'CLOUD_TIME_LIMIT' : safeCode(error);
    return { ...report, ok: false, marker: report.simulated ? 'CLOUD_FAILURE_DRILL' : 'CLOUD_TASK_FAILED', error: code, phase, finishedAt: new Date(now()).toISOString(),
      outcomeMayNeedReadback: Object.values(mutations).some(value => value > 0) };
  } finally { clearTimeout(timer); }
}
