#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const sourcePattern = /^(api|client|packages)\/.*\.(js|jsx|ts|tsx)$/;
const frontendPattern = /^(client|packages\/client|packages\/data-provider)\//;

function run(command, args) {
  const result = spawnSync(commandForPlatform(command), args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function commandForPlatform(command) {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'npm' || command === 'npx') {
    return `${command}.cmd`;
  }

  return command;
}

function stagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((file) => file.trim().replaceAll('\\', '/'))
    .filter(Boolean);
}

const files = stagedFiles();
const sourceFiles = files.filter((file) => sourcePattern.test(file));

if (sourceFiles.length === 0) {
  console.log('Stara pre-commit CI: no staged source files to check.');
  process.exit(0);
}

console.log('Stara pre-commit CI: checking staged source files:');
for (const file of sourceFiles) {
  console.log(`- ${file}`);
}

run('npx', [
  'eslint',
  '--no-error-on-unmatched-pattern',
  '--config',
  'eslint.config.mjs',
  '--max-warnings=0',
  '--',
  ...sourceFiles,
]);
run('npx', ['prettier', '--check', '--no-error-on-unmatched-pattern', '--', ...sourceFiles]);
run('node', ['scripts/sort-imports.mts', '--check', ...sourceFiles]);

const touched = (pattern) => files.some((file) => pattern.test(file));

if (touched(frontendPattern)) {
  run('npm', ['--prefix', 'client', 'run', 'typecheck']);
  run('npm', ['run', 'frontend:ci']);
}

if (touched(/^client\//)) {
  run('npm', ['run', 'test:client']);
}

if (touched(/^api\//)) {
  run('npm', ['run', 'test:api']);
}

if (touched(/^packages\/api\//)) {
  run('npm', ['run', 'test:packages:api']);
}

if (touched(/^packages\/data-provider\//)) {
  run('npm', ['run', 'test:packages:data-provider']);
}

if (touched(/^packages\/data-schemas\//)) {
  run('npm', ['run', 'test:packages:data-schemas']);
}
