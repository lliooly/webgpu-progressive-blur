import {
  cpSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(repositoryRoot, 'tests/fixtures');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'progressive-blur-fixtures-'));

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
}

function packCurrentPackage() {
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  const result = JSON.parse(output);
  return join(temporaryRoot, result[0].filename);
}

function verifyFixture(name, cliArgs, checks) {
  const source = join(fixtureRoot, name);
  const destination = join(temporaryRoot, name);
  cpSync(source, destination, { recursive: true });
  run('npm', ['ci', '--ignore-scripts'], destination);
  run('npm', ['install', '--ignore-scripts', '--no-save', packFile], destination);
  run('npx', ['--no-install', 'webgpu-progressive-blur', ...cliArgs, '--no-install'], destination);
  for (const [command, args] of checks) run(command, args, destination);
  console.log(`fixture passed: ${name}`);
}

let packFile;
try {
  packFile = packCurrentPackage();
  verifyFixture(
    'react-18',
    ['add', 'navbar', '--framework', 'react'],
    [
      ['npm', ['run', 'typecheck']],
      ['npm', ['run', 'build']],
    ],
  );
  verifyFixture(
    'react-19',
    ['add', '--framework', 'react'],
    [
      ['npm', ['run', 'typecheck']],
      ['npm', ['run', 'build']],
    ],
  );
  verifyFixture(
    'astro-static',
    ['add', 'navbar', '--framework', 'astro'],
    [
      ['npm', ['run', 'check']],
      ['npm', ['run', 'build']],
    ],
  );
  verifyFixture(
    'astro-router',
    ['add', '--framework', 'astro'],
    [
      ['npm', ['run', 'check']],
      ['npm', ['run', 'build']],
    ],
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
