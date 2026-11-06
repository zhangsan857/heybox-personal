import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeCloud } from './worker.mjs';
import { atomicJson } from './policy.mjs';
import { verifyBundle } from './verify.mjs';

async function main() {
  verifyBundle(false);
  if (!process.env.RUNNER_TEMP || process.env.RUNNER_OS !== 'Linux') throw new Error('CLOUD_RUNNER_REQUIRED');
  const output = path.join(process.env.RUNNER_TEMP, 'heybox-cloud-result.json');
  const result = await executeCloud(process.env, { progress: value => console.log('CLOUD_PHASE=' + value.phase) });
  atomicJson(output, result);
  console.log(result.marker);
  if (result.error) console.log('CLOUD_ERROR=' + result.error);
  console.log('CLOUD_EXECUTED=' + result.executed.join(','));
  console.log('CLOUD_BUSINESS_REQUESTS=' + Object.values(result.mutations).reduce((a, b) => a + b, 0));
  process.exitCode = result.ok ? 0 : 1;
}

try { await main(); }
catch { console.error('CLOUD_ENTRY_FAILED'); process.exitCode = 1; }
