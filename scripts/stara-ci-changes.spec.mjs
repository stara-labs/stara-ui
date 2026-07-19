import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyStaraCiChanges } from './stara-ci-changes.mjs';

test('runs only the unique API gate for ordinary API source changes', () => {
  assert.deepEqual(classifyStaraCiChanges(['packages/api/src/app/service.ts']), {
    production_audit: false,
    api_integration: true,
  });
});

test('dependency and workflow changes expand the appropriate matrix', () => {
  const dependency = classifyStaraCiChanges(['package-lock.json']);
  assert.equal(dependency.production_audit, true);
  assert.equal(dependency.api_integration, true);

  assert.deepEqual(
    classifyStaraCiChanges(['.github/workflows/stara-product-ci.yml']),
    classifyStaraCiChanges([], { forceAll: true }),
  );
});

test('keeps unrelated documentation changes out of expensive jobs', () => {
  assert.deepEqual(classifyStaraCiChanges(['docs/runtime.md']), {
    production_audit: false,
    api_integration: false,
  });
});
