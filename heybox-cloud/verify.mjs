import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export function verifyBundle(print = true) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.upstreamCommit !== 'dde82466d3b02aae38c220343443ad8e958c481a') throw new Error('CLOUD_BUNDLE_PIN_INVALID');
  const seen = [];
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory)) {
      const relative = prefix + name, file = path.join(directory, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('CLOUD_BUNDLE_LINK_DENIED');
      if (stat.isDirectory()) walk(file, relative + '/');
      else if (relative !== 'manifest.json') seen.push(relative);
    }
  }
  walk(root);
  if (seen.sort().join('\n') !== Object.keys(manifest.files).sort().join('\n')) throw new Error('CLOUD_BUNDLE_FILESET_CHANGED');
  for (const relative of seen) {
    const actual = createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex');
    if (actual !== manifest.files[relative]) throw new Error('CLOUD_BUNDLE_HASH_MISMATCH');
  }
  if (print) console.log(`Bundle files: ${seen.length + 1}\nCLOUD_BUNDLE_OK`);
  return seen.length + 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyBundle(); } catch { console.error('CLOUD_BUNDLE_INVALID'); process.exitCode = 1; }
}
