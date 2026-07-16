#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
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

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const expectedName = pkg.name.startsWith('@')
  ? `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}.tgz`
  : `${pkg.name}-${pkg.version}.tgz`;

const before = new Set(readdirSync(root).filter((name) => name.endsWith('.tgz')));

execFileSync('npm', ['pack'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const created = readdirSync(root)
  .filter((name) => name.endsWith('.tgz') && !before.has(name));

const filename = created.includes(expectedName)
  ? expectedName
  : created[0] ?? (existsSync(path.join(root, expectedName)) ? expectedName : null);

if (!filename) {
  console.error('FAIL: npm pack did not produce a .tgz');
  process.exit(1);
}

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
