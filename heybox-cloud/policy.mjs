import { openSync, closeSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const ids = ['sign', '1', '19', '31'];
export const names = { sign: '签到', '1': '分享帖子', '19': '分享游戏', '31': '分享游戏评价' };
export const dayNumber = time => Math.floor((time + 8 * 3600_000) / 86400_000);
export const beijingDay = (time = Date.now()) => new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
export const untilMidnight = time => (dayNumber(time) + 1) * 86400_000 - 8 * 3600_000 - time;
export const pending = snapshot => ids.filter(id => id === 'sign' ? !snapshot.signed : snapshot.tasks.find(task => task.id === id)?.state !== 'finish');
export function compactSnapshot(snapshot) {
  return { signed: snapshot.signed, shares: Object.fromEntries(ids.slice(1).map(id => [id, snapshot.tasks.find(task => task.id === id)?.state])),
    exp: snapshot.exp, coin: snapshot.coin, battery: snapshot.battery, level: snapshot.level };
}

export function guardedFetch({ write = false, day, now = Date.now, checkpoint = () => {}, phase = () => '', onMutation = () => {}, signal, fetchImpl = globalThis.fetch }) {
  const read = new Set(['GET https://api.xiaoheihe.cn/task/list_v2/', 'GET https://api.xiaoheihe.cn/task/sign_v4/get_sign_state']);
  const additional = new Set([
    'GET https://api.xiaoheihe.cn/task/sign_v3/sign',
    'GET https://api.xiaoheihe.cn/bbs/app/feeds', 'GET https://api.xiaoheihe.cn/game/all_recommend/v2',
    'GET https://api.xiaoheihe.cn/bbs/app/link/game/comments', 'GET https://api.xiaoheihe.cn/game/comment/share_data/',
    'POST https://data.xiaoheihe.cn/account/data_report/',
  ]);
  return async (input, options = {}) => {
    signal?.throwIfAborted();
    if (beijingDay(now()) !== day) throw new Error('STAGE4_DAY_CHANGED');
    await checkpoint();
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    const key = `${method} ${url.origin}${url.pathname}`;
    if (url.username || url.password || !(read.has(key) || write && additional.has(key))) throw new Error('STAGE4_REQUEST_BLOCKED');
    if (url.pathname === '/task/sign_v3/sign') {
      if (phase() !== 'sign') throw new Error('STAGE4_MUTATION_PHASE_MISMATCH');
      onMutation('sign');
    }
    if (url.pathname === '/account/data_report/') {
      const match = /^share_(1|19|31)$/.exec(phase());
      if (!match) throw new Error('STAGE4_MUTATION_PHASE_MISMATCH');
      onMutation(match[1]);
    }
    const signals = [options.signal || input?.signal, signal].filter(Boolean);
    return fetchImpl(input, { ...options, redirect: 'error', ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
  };
}

export function creditedTasks(result, after, mutations) {
  if (!result?.completed || pending(after).length) throw new Error('STAGE4_RESULT_NOT_VERIFIED');
  const executed = ids.filter(id => result.execution?.[id] === 'executed');
  if (executed.some(id => !(mutations[id] > 0))) throw new Error('STAGE4_REQUEST_EVIDENCE_MISSING');
  return executed;
}

export function addEvidence(previous, { accountId, sourceHash, day, runId, credited }) {
  if (previous && (previous.accountId !== accountId || previous.sourceHash !== sourceHash)) throw new Error('STAGE4_EVIDENCE_CONTEXT_CHANGED');
  const next = { accountId, sourceHash, tasks: { ...(previous?.tasks || {}) } };
  for (const id of credited) {
    if (!ids.includes(id)) throw new Error('STAGE4_UNKNOWN_TASK');
    next.tasks[id] = { day, runId };
  }
  return next;
}

export function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

export function acquireLock(file) {
  let descriptor;
  try { descriptor = openSync(file, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('STAGE4_ALREADY_RUNNING'); throw error; }
  try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n'); }
  catch (error) { closeSync(descriptor); rmSync(file, { force: true }); throw error; }
  return () => { closeSync(descriptor); rmSync(file, { force: true }); };
}

export function failureCode(error) {
  const known = new Set(['APP_AUTH_EXPIRED', 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_CAPTCHA_REQUIRED', 'SIGN_NOT_VERIFIED', 'SHARE_NOT_SETTLED', 'TASK_SCHEMA_CHANGED', 'ACCOUNT_READBACK_MISMATCH']);
  if (known.has(error?.message)) return error.message;
  if (/^REQUEST_NOT_CONFIRMED(?::[a-z0-9_]{1,32}){0,3}$/.test(error?.message || '')) return error.message;
  for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    if (/^(?:STAGE4_|PRIVATE_|SOURCE_|TOOL_)[A-Z0-9_]+$/.test(current.message || '')) return current.message;
  }
  if (error?.name === 'AbortError') return 'STAGE4_CANCELLED';
  if (error?.category === 'auth') return 'APP_AUTH_EXPIRED';
  if (error?.rateLimited) return 'UPSTREAM_RATE_LIMIT';
  if (error?.captchaRequired) return 'UPSTREAM_CAPTCHA_REQUIRED';
  const text = String(error?.message || '');
  if (/签到未确认到账/.test(text)) return 'SIGN_NOT_VERIFIED';
  if (/上报后未结算/.test(text)) return 'SHARE_NOT_SETTLED';
  if (/最终状态未通过/.test(text)) return 'STAGE4_RESULT_NOT_VERIFIED';
  if (/任务.*(?:缺失|状态变化)|每日任务列表为空/.test(text)) return 'TASK_SCHEMA_CHANGED';
  if (/账号不匹配/.test(text)) return 'ACCOUNT_READBACK_MISMATCH';
  const category = /^[a-z_]{1,24}$/.test(error?.category || '') ? error.category : '';
  const status = /^[a-z_]{1,32}$/.test(error?.status || '') ? error.status : '';
  const http = Number.isInteger(error?.httpStatus) ? String(error.httpStatus) : '';
  return ['REQUEST_NOT_CONFIRMED', category, status, http].filter(Boolean).join(':');
}
