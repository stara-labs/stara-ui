#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const dependencyPattern = /(^|\/)package(?:-lock)?\.json$/;
const workflowPattern =
  /^(?:\.github\/workflows\/stara-product-ci\.yml|scripts\/stara-ci-changes(?:\.spec)?\.mjs)$/;

export function classifyStaraCiChanges(files, { forceAll = false } = {}) {
  const normalized = files.map((file) => file.trim().replaceAll('\\', '/')).filter(Boolean);
  const workflowChanged = normalized.some((file) => workflowPattern.test(file));
  const dependenciesChanged = normalized.some(
    (file) => dependencyPattern.test(file) || file === '.nvmrc',
  );
  const all = forceAll || workflowChanged;

  return {
    production_audit: all || dependenciesChanged,
    api_integration:
      all ||
      dependenciesChanged ||
      normalized.some((file) =>
        /^(?:api\/|packages\/(?:api|data-provider|data-schemas)\/)/.test(file),
      ),
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function changedFiles(base, head) {
  if (!base || !head || /^0+$/.test(base)) {
    throw new Error('A valid base and head SHA are required when change filtering is enabled.');
  }
  return execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}...${head}`],
    { encoding: 'utf8' },
  ).split(/\r?\n/);
}

function run() {
  const forceAll = process.argv.includes('--all') || process.env.STARA_CI_FORCE_ALL === 'true';
  const files = forceAll
    ? []
    : changedFiles(
        argument('--base') ?? process.env.STARA_CI_BASE_SHA,
        argument('--head') ?? process.env.STARA_CI_HEAD_SHA ?? 'HEAD',
      );
  const result = classifyStaraCiChanges(files, { forceAll });
  const output = Object.entries(result)
    .map(([name, enabled]) => `${name}=${enabled ? 'true' : 'false'}`)
    .join('\n');

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`, 'utf8');
  } else {
    process.stdout.write(`${output}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
