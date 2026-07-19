import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  readStaraGateProof,
  staraGateProofPath,
  writeStaraGateProof,
} from './stara-gate-proof.mjs';

const temporaryDirectories = [];
const context = {
  tree: 'a'.repeat(40),
  scope: 'c'.repeat(64),
  platform: 'win32',
  arch: 'x64',
  nodeVersion: 'v24.16.0',
};

function cacheDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'stara-gate-proof-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reuses a fresh proof only for the exact tree and runtime', () => {
  const directory = cacheDirectory();
  const now = Date.UTC(2026, 6, 18, 12);
  writeStaraGateProof(directory, context, { now });

  assert.ok(readStaraGateProof(directory, context, { now: now + 1_000 }));
  assert.equal(
    readStaraGateProof(directory, { ...context, tree: 'b'.repeat(40) }, { now: now + 1_000 }),
    undefined,
  );
  assert.equal(
    readStaraGateProof(directory, { ...context, scope: 'd'.repeat(64) }, { now: now + 1_000 }),
    undefined,
  );
  assert.equal(
    readStaraGateProof(directory, { ...context, nodeVersion: 'v24.17.0' }, { now: now + 1_000 }),
    undefined,
  );
});

test('rejects stale or malformed proofs', () => {
  const directory = cacheDirectory();
  const now = Date.UTC(2026, 6, 18, 12);
  writeStaraGateProof(directory, context, { now });

  assert.equal(
    readStaraGateProof(directory, context, { now: now + 10_001, maxAgeMs: 10_000 }),
    undefined,
  );
  assert.throws(
    () => staraGateProofPath(directory, { ...context, tree: '../../not-a-tree' }),
    /valid Git tree/,
  );
});
