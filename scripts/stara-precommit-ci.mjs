#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const sourcePattern = /^(api|client|packages)\/.*\.(js|jsx|ts|tsx)$/;
const frontendPattern = /^(client|packages\/client|packages\/data-provider)\//;
const dependencyPattern = /(^|\/)package(?:-lock)?\.json$/;
const mode = process.argv.includes('--push') ? 'pre-push' : 'pre-commit';

function run(command, args, options = {}) {
  const result = spawnSync(commandForPlatform(command), args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
    env: options.env ?? process.env,
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
  const result = gitOutput(['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB']);

  return normalizeFiles(result.stdout);
}

function pushedFiles() {
  const base =
    gitOutput(['merge-base', 'HEAD', '@{upstream}'], { allowFailure: true }).stdout.trim() ||
    gitOutput(['merge-base', 'HEAD', 'origin/main'], { allowFailure: true }).stdout.trim() ||
    gitOutput(['rev-parse', 'HEAD~1'], { allowFailure: true }).stdout.trim();

  if (!base) {
    return [];
  }

  const result = gitOutput(['diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}...HEAD`]);

  return normalizeFiles(result.stdout);
}

function gitOutput(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
  });

  if (result.status !== 0 && !options.allowFailure) {
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

function normalizeFiles(output) {
  return output
    .split(/\r?\n/)
    .map((file) => file.trim().replaceAll('\\', '/'))
    .filter(Boolean);
}

const files = mode === 'pre-push' ? pushedFiles() : stagedFiles();
const sourceFiles = files.filter((file) => sourcePattern.test(file));
const dependenciesTouched = files.some((file) => dependencyPattern.test(file));

if (sourceFiles.length === 0 && !dependenciesTouched) {
  console.log(`Stara ${mode} CI: no source or dependency files to check.`);
  process.exit(0);
}

console.log(`Stara ${mode} CI: checking files:`);
for (const file of files) {
  console.log(`- ${file}`);
}

if (sourceFiles.length > 0) {
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
}

if (dependenciesTouched) {
  // A lockfile-only change can alter every workspace and the production image.
  run('npm', ['run', 'security:audit:production']);
  run('npm', ['run', 'build:safe']);

  if (process.platform === 'win32') {
    run('npm', ['run', 'test:client']);
    // Reset Jest's retained heap between shards; the complete API suite exceeds 8 GB in one process.
    for (const shard of ['1/2', '2/2']) {
      run(
        'npm',
        [
          '--prefix',
          'api',
          'run',
          'test:ci',
          '--',
          '--maxWorkers=2',
          '--silent',
          `--shard=${shard}`,
        ],
        {
          env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
        },
      );
    }
    run('npm', ['--prefix', 'packages/api', 'run', 'test:ci', '--', '--maxWorkers=2', '--silent']);
    run('npm', ['run', 'test:packages:data-provider']);
    run('npm', ['run', 'test:packages:data-schemas']);
  } else {
    run('npm', ['run', 'test:all']);
  }

  run('npm', ['--prefix', 'packages/client', 'run', 'test:ci']);
  run('npm', ['run', 'test:config']);
  process.exit(0);
}

const touched = (pattern) => files.some((file) => pattern.test(file));
const frontendTouched = touched(frontendPattern);
const apiTouched = touched(/^api\//);

if (frontendTouched) {
  run('npm', ['run', 'frontend:ci']);
  run('npm', ['--prefix', 'client', 'run', 'typecheck']);
}

if (touched(/^client\//)) {
  run('npm', ['run', 'test:client']);
}

if (apiTouched) {
  if (!frontendTouched) {
    run('npm', ['run', 'build:data-provider']);
  }
  run('npm', ['run', 'build:data-schemas']);
  run('npm', ['run', 'build:api']);
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
