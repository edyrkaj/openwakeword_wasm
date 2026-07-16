#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
for (const needle of ['@edyrkaj/openwakeword-wasm-browser', 'externalDataFiles']) {
  if (!readme.includes(needle)) {
    console.error(`FAIL: README.md missing required docs string: ${needle}`);
    process.exit(1);
  }
}

const packJson = execFileSync('npm', ['pack', '--json'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const [{ filename }] = JSON.parse(packJson);
const listing = execFileSync('tar', ['-tzf', filename], {
  cwd: root,
  encoding: 'utf8',
});

const leaked = listing
  .split('\n')
  .filter((line) => /(?:^|\/)models\/|\.onnx$|\.tflite$/.test(line));

if (leaked.length) {
  console.error('FAIL: tarball must not contain models/ or model binaries:');
  for (const line of leaked) console.error(`  ${line}`);
  unlinkSync(path.join(root, filename));
  process.exit(1);
}

if (!listing.includes('package/src/WakeWordEngine.js')) {
  console.error('FAIL: expected package/src/WakeWordEngine.js in tarball');
  unlinkSync(path.join(root, filename));
  process.exit(1);
}

unlinkSync(path.join(root, filename));
console.log(`OK: ${filename} is library-only; README docs gate passed.`);
