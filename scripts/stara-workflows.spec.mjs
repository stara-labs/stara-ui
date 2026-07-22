import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflowDirectory = fileURLToPath(new URL('../.github/workflows/', import.meta.url));

function workflow(name) {
  return parse(readFileSync(`${workflowDirectory}${name}.yml`, 'utf8'));
}

test('Stara Product CI contains only unique product gates', () => {
  const definition = workflow('stara-product-ci');
  assert.deepEqual(Object.keys(definition.jobs), [
    'changes',
    'production-dependency-audit',
    'api-integration-tests',
    'full-suite',
  ]);
  assert.deepEqual(definition.jobs['full-suite'].needs, [
    'changes',
    'production-dependency-audit',
    'api-integration-tests',
  ]);
});

test('canonical Playwright and Docker workflows retain Stara-specific coverage', () => {
  const playwright = workflow('playwright-mock');
  const playwrightSteps = playwright.jobs['e2e-shards'].steps
    .map((step) => step.name)
    .filter(Boolean);
  assert.ok(playwrightSteps.includes('Run enforced model-spec E2E'));
  assert.deepEqual(playwright.jobs['e2e-shards'].strategy.matrix.shard, [1, 2]);
  assert.match(
    playwright.jobs['e2e-shards'].steps.find((step) => step.name === 'Run mock-LLM Tier-1 e2e').run,
    /--shard=\$\{\{ matrix\.shard \}\}\/2/,
  );
  const playwrightRuntime = playwright.jobs['e2e-shards'].steps.find(
    (step) => step.name === 'Install Playwright runtime dependencies',
  ).run;
  assert.match(playwrightRuntime, /ffmpeg-\$FFMPEG_REVISION/);
  assert.doesNotMatch(playwrightRuntime, /playwright install ffmpeg/);
  assert.equal(playwright.jobs.e2e.needs, 'e2e-shards');
  assert.deepEqual(playwright.on.push.branches, ['main']);

  const docker = workflow('docker-smoke');
  const dockerSteps = docker.jobs['api-runtime-smoke'].steps
    .map((step) => step.name)
    .filter(Boolean);
  assert.ok(dockerSteps.includes('Boot native Stara image without legacy state services'));
  assert.deepEqual(docker.on.push.branches, ['main']);
});

test('backend main builds warm caches for subsequent pull requests', () => {
  const backend = workflow('backend-review');
  assert.deepEqual(backend.on.push.branches, ['main']);
  assert.ok(backend.on.pull_request.paths.includes('.github/workflows/backend-review.yml'));
  assert.equal(backend.concurrency['cancel-in-progress'], true);
});

test('cache integration reruns when the locked dependency graph changes', () => {
  const cache = workflow('cache-integration-tests');
  const paths = cache.on.pull_request.paths;
  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('package-lock.json'));
});
