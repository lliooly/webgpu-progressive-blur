import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
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

function packScopedPackage() {
  const sourceRoot = mkdtempSync(join(temporaryRoot, 'scoped-package-'));
  for (const entry of [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'cli',
    'dist',
    'package.json',
    'templates',
  ]) {
    cpSync(join(repositoryRoot, entry), join(sourceRoot, entry), {
      recursive: true,
    });
  }
  const manifestPath = join(sourceRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.name = '@lliooly/webgpu-progressive-blur';
  manifest.publishConfig = {
    ...manifest.publishConfig,
    registry: 'https://npm.pkg.github.com',
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
    { cwd: sourceRoot, encoding: 'utf8' },
  );
  const result = JSON.parse(output);
  return join(temporaryRoot, result[0].filename);
}

function verifyFixture(
  name,
  cliArgs,
  checks,
  packageFile = packFile,
  sourceName = name,
) {
  const source = join(fixtureRoot, sourceName);
  const destination = join(temporaryRoot, name);
  cpSync(source, destination, { recursive: true });
  run('npm', ['ci', '--ignore-scripts'], destination);
  run('npm', ['install', '--ignore-scripts', '--no-save', packageFile], destination);
  run('npx', ['--no-install', 'webgpu-progressive-blur', ...cliArgs, '--no-install'], destination);
  for (const [command, args] of checks) run(command, args, destination);
  console.log(`fixture passed: ${name}`);
}

let packFile;
let scopedPackFile;
try {
  packFile = packCurrentPackage();
  scopedPackFile = packScopedPackage();
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
  verifyFixture(
    'react-19-scoped',
    ['add', '--framework', 'react'],
    [
      ['npm', ['run', 'typecheck']],
      ['npm', ['run', 'build']],
    ],
    scopedPackFile,
    'react-19',
  );
  verifyFixture(
    'astro-router-scoped',
    ['add', '--framework', 'astro'],
    [
      ['npm', ['run', 'check']],
      ['npm', ['run', 'build']],
    ],
    scopedPackFile,
    'astro-router',
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
