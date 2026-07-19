import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STARA_GATE_PROOF_VERSION = 1;
export const STARA_GATE_PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function normalizeContext(context) {
  const tree = String(context?.tree ?? '')
    .trim()
    .toLowerCase();
  const platform = String(context?.platform ?? '').trim();
  const arch = String(context?.arch ?? '').trim();
  const nodeVersion = String(context?.nodeVersion ?? '').trim();
  const scope = String(context?.scope ?? '')
    .trim()
    .toLowerCase();

  if (
    !/^[0-9a-f]{40,64}$/.test(tree) ||
    !/^[0-9a-f]{64}$/.test(scope) ||
    !platform ||
    !arch ||
    !nodeVersion
  ) {
    throw new Error(
      'A valid Git tree, change scope, and runtime context are required for a Stara gate proof.',
    );
  }

  return { tree, scope, platform, arch, nodeVersion };
}

function safeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function staraGateProofPath(cacheDirectory, context) {
  const normalized = normalizeContext(context);
  const runtime = [normalized.platform, normalized.arch, normalized.nodeVersion]
    .map(safeSegment)
    .join('-');
  return join(cacheDirectory, `${normalized.tree}-${normalized.scope}-${runtime}.json`);
}

export function readStaraGateProof(
  cacheDirectory,
  context,
  { now = Date.now(), maxAgeMs = STARA_GATE_PROOF_MAX_AGE_MS } = {},
) {
  const normalized = normalizeContext(context);
  try {
    const proof = JSON.parse(readFileSync(staraGateProofPath(cacheDirectory, normalized), 'utf8'));
    const completedAt = Date.parse(proof.completedAt);
    const age = now - completedAt;
    if (
      proof.version !== STARA_GATE_PROOF_VERSION ||
      proof.tree !== normalized.tree ||
      proof.scope !== normalized.scope ||
      proof.platform !== normalized.platform ||
      proof.arch !== normalized.arch ||
      proof.nodeVersion !== normalized.nodeVersion ||
      !Number.isFinite(completedAt) ||
      age < 0 ||
      age > maxAgeMs
    ) {
      return undefined;
    }
    return proof;
  } catch {
    return undefined;
  }
}

export function writeStaraGateProof(cacheDirectory, context, { now = Date.now() } = {}) {
  const normalized = normalizeContext(context);
  const proof = {
    version: STARA_GATE_PROOF_VERSION,
    ...normalized,
    completedAt: new Date(now).toISOString(),
  };
  const target = staraGateProofPath(cacheDirectory, normalized);
  const temporary = `${target}.${process.pid}.${now}.tmp`;

  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  rmSync(target, { force: true });
  renameSync(temporary, target);
  return proof;
}
