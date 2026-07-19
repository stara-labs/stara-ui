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
  const playwrightSteps = playwright.jobs.e2e.steps.map((step) => step.name).filter(Boolean);
  assert.ok(playwrightSteps.includes('Run enforced model-spec E2E'));

  const docker = workflow('docker-smoke');
  const dockerSteps = docker.jobs['api-runtime-smoke'].steps
    .map((step) => step.name)
    .filter(Boolean);
  assert.ok(dockerSteps.includes('Boot native Stara image without legacy state services'));
});

test('cache integration reruns when the locked dependency graph changes', () => {
  const cache = workflow('cache-integration-tests');
  const paths = cache.on.pull_request.paths;
  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('package-lock.json'));
});
