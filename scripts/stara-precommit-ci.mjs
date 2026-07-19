#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readStaraGateProof, writeStaraGateProof } from './stara-gate-proof.mjs';

const sourcePattern = /^(api|client|packages)\/.*\.(js|jsx|ts|tsx)$/;
const lintablePattern =
  /^(?:(?:api|client|packages)\/.*\.(?:js|jsx|ts|tsx)|scripts\/stara-.*\.mjs)$/;
const frontendPattern = /^(client|packages\/client|packages\/data-provider)\//;
const dependencyPattern = /(^|\/)package(?:-lock)?\.json$/;
const gateInfrastructurePattern =
  /^(?:scripts\/stara-.*\.mjs|\.husky\/(?:pre-commit|pre-push)|\.github\/workflows\/(?:stara-product-ci|playwright-mock|docker-smoke|cache-integration-tests)\.yml)$/;
const testFilePattern = /\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/;
const quick = process.argv.includes('--quick');
let mode = 'full';
if (process.argv.includes('--push')) {
  mode = 'pre-push';
} else if (quick) {
  mode = 'pre-commit quick';
}

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

function gateProofState(files) {
  const unstagedTracked = normalizeFiles(
    gitOutput(['diff', '--name-only', '--diff-filter=ACMRTUXB']).stdout,
  );
  const untrackedRelevant = normalizeFiles(
    gitOutput(['ls-files', '--others', '--exclude-standard']).stdout,
  ).filter(
    (file) =>
      sourcePattern.test(file) ||
      dependencyPattern.test(file) ||
      gateInfrastructurePattern.test(file),
  );

  if (unstagedTracked.length > 0 || untrackedRelevant.length > 0) {
    console.log('Stara full gate proof reuse is disabled by relevant unstaged files.');
    return undefined;
  }

  const tree =
    mode === 'pre-push'
      ? gitOutput(['rev-parse', 'HEAD^{tree}']).stdout.trim()
      : gitOutput(['write-tree']).stdout.trim();
  const gitPath = gitOutput(['rev-parse', '--git-path', 'stara-gate-cache']).stdout.trim();
  return {
    cacheDirectory: resolve(gitPath),
    context: {
      tree,
      scope: createHash('sha256')
        .update([...new Set(files)].sort().join('\0'))
        .digest('hex'),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
  };
}

function runFocusedTests(workspace, tests) {
  if (tests.length === 0) {
    return;
  }
  const relativeTests = tests.map((file) => file.slice(workspace.length + 1));
  const jestArgs = ['--coverage=false'];
  if (process.platform === 'win32') {
    jestArgs.push('--maxWorkers=2', '--silent');
  }
  jestArgs.push('--runTestsByPath', ...relativeTests);
  run('npm', ['--prefix', workspace, 'run', 'test:ci', '--', ...jestArgs], {
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
}

function runQuickChecks(files) {
  const touched = (pattern) => files.some((file) => pattern.test(file));
  const apiTouched = touched(/^api\//);
  const packageApiTouched = touched(/^packages\/api\//);
  const clientTouched = touched(/^client\//);
  const packageClientTouched = touched(/^packages\/client\//);
  const dataProviderTouched = touched(/^packages\/data-provider\//);
  const dataSchemasTouched = touched(/^packages\/data-schemas\//);

  if (dependenciesTouched) {
    run('npm', ['run', 'security:audit:production']);
  }

  if (
    apiTouched ||
    packageApiTouched ||
    clientTouched ||
    packageClientTouched ||
    dataProviderTouched ||
    dataSchemasTouched
  ) {
    run('npm', ['run', 'build:data-provider']);
  }
  if (apiTouched || packageApiTouched || dataSchemasTouched) {
    run('npm', ['run', 'build:data-schemas']);
  }
  if (apiTouched || packageApiTouched) {
    run('npm', ['run', 'build:api']);
  }
  if (clientTouched || packageClientTouched) {
    run('npm', ['run', 'build:client-package']);
  }

  runFocusedTests(
    'api',
    files.filter((file) => /^api\//.test(file) && testFilePattern.test(file)),
  );
  runFocusedTests(
    'packages/api',
    files.filter((file) => /^packages\/api\//.test(file) && testFilePattern.test(file)),
  );
  runFocusedTests(
    'client',
    files.filter((file) => /^client\//.test(file) && testFilePattern.test(file)),
  );
  runFocusedTests(
    'packages/client',
    files.filter((file) => /^packages\/client\//.test(file) && testFilePattern.test(file)),
  );
  runFocusedTests(
    'packages/data-provider',
    files.filter((file) => /^packages\/data-provider\//.test(file) && testFilePattern.test(file)),
  );
  runFocusedTests(
    'packages/data-schemas',
    files.filter((file) => /^packages\/data-schemas\//.test(file) && testFilePattern.test(file)),
  );
}

function runGateInfrastructureTests() {
  run('node', [
    '--test',
    'scripts/stara-gate-proof.spec.mjs',
    'scripts/stara-ci-changes.spec.mjs',
    'scripts/stara-workflows.spec.mjs',
  ]);
}

function filesToCheck() {
  if (mode === 'pre-push') {
    return pushedFiles();
  }
  if (quick) {
    return stagedFiles();
  }
  return [...pushedFiles(), ...stagedFiles()];
}

const files = [...new Set(filesToCheck())].sort();
const sourceFiles = files.filter((file) => sourcePattern.test(file));
const lintableFiles = files.filter((file) => lintablePattern.test(file));
const prettierFiles = [
  ...new Set([...lintableFiles, ...files.filter((file) => /\.ya?ml$/.test(file))]),
];
const dependenciesTouched = files.some((file) => dependencyPattern.test(file));
const gateInfrastructureTouched = files.some((file) => gateInfrastructurePattern.test(file));

if (sourceFiles.length === 0 && !dependenciesTouched && !gateInfrastructureTouched) {
  console.log(`Stara ${mode} CI: no source or dependency files to check.`);
  process.exit(0);
}

const proofState = quick ? undefined : gateProofState(files);
if (proofState && readStaraGateProof(proofState.cacheDirectory, proofState.context) !== undefined) {
  console.log(`Stara ${mode} CI: reusing full gate proof for tree ${proofState.context.tree}.`);
  process.exit(0);
}

function recordFullGateProof() {
  if (!proofState) {
    return;
  }
  const proof = writeStaraGateProof(proofState.cacheDirectory, proofState.context);
  console.log(`Stara full gate proof recorded for tree ${proof.tree}.`);
}

console.log(`Stara ${mode} CI: checking files:`);
for (const file of files) {
  console.log(`- ${file}`);
}

if (lintableFiles.length > 0) {
  run('npx', [
    'eslint',
    '--no-error-on-unmatched-pattern',
    '--config',
    'eslint.config.mjs',
    '--max-warnings=0',
    '--',
    ...lintableFiles,
  ]);
  if (sourceFiles.length > 0) {
    run('node', ['scripts/sort-imports.mts', '--check', ...sourceFiles]);
  }
}

if (prettierFiles.length > 0) {
  run('npx', ['prettier', '--check', '--no-error-on-unmatched-pattern', '--', ...prettierFiles]);
}

if (gateInfrastructureTouched) {
  runGateInfrastructureTests();
}

if (quick) {
  runQuickChecks(files);
  process.exit(0);
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
  recordFullGateProof();
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
  if (process.platform === 'win32') {
    run('npm', ['--prefix', 'api', 'run', 'test:ci', '--', '--maxWorkers=2', '--silent'], {
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
    });
  } else {
    run('npm', ['run', 'test:api']);
  }
}

if (touched(/^packages\/api\//)) {
  if (process.platform === 'win32') {
    run('npm', ['--prefix', 'packages/api', 'run', 'test:ci', '--', '--maxWorkers=2', '--silent'], {
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
    });
  } else {
    run('npm', ['run', 'test:packages:api']);
  }
}

if (touched(/^packages\/data-provider\//)) {
  run('npm', ['run', 'test:packages:data-provider']);
}

if (touched(/^packages\/data-schemas\//)) {
  run('npm', ['run', 'test:packages:data-schemas']);
}

recordFullGateProof();
