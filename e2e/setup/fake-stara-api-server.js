#!/usr/bin/env node

const http = require('http');
const { randomUUID } = require('crypto');

const DEFAULT_PORT = 8770;
const DEFAULT_HOST = '127.0.0.1';

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function header(req, name, fallback = '') {
  const value = req.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function assuranceFor(req) {
  const emailVerified = header(req, 'x-stara-email-verified') === 'true';
  const mfaEnrolled = header(req, 'x-stara-mfa-enrolled') === 'true';
  return {
    email_verified: emailVerified,
    mfa_enrolled: mfaEnrolled,
    regulated_surfaces_ready: emailVerified && mfaEnrolled,
  };
}

function createUser(req, existing) {
  return {
    id: existing?.id ?? randomUUID(),
    identity_subject: header(req, 'x-stara-identity-subject', 'e2e-user'),
    email: header(req, 'x-stara-actor-email', 'testuser@example.com').toLowerCase(),
    display_name: header(req, 'x-stara-display-name', 'E2E user'),
    active_tenant_id: null,
    profile: existing?.profile ?? {
      stara_onboarding: {
        version: 1,
        account: null,
        tenant_addenda: {},
        updated_at: null,
      },
    },
  };
}

function onboardingRecord(body, completedAt) {
  return {
    version: 1,
    completed_at: completedAt,
    mode: body.mode,
    recommended_start: body.recommended_start ?? 'chat',
    ...(typeof body.readiness_score === 'number' ? { readiness_score: body.readiness_score } : {}),
    responses: body.responses ?? {},
  };
}

function createFakeStaraApiServer() {
  const users = new Map();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if ((url.pathname === '/' || url.pathname === '/healthz') && req.method === 'GET') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    const subject = header(req, 'x-stara-identity-subject', 'e2e-user');
    const user = createUser(req, users.get(subject));
    users.set(subject, user);

    if (url.pathname === '/v1/identity/sync' && req.method === 'POST') {
      sendJson(res, 200, { user, assurance: assuranceFor(req) });
      return;
    }

    if (url.pathname === '/v1/me/onboarding' && req.method === 'PUT') {
      try {
        const body = await readJson(req);
        const completedAt = new Date().toISOString();
        const onboarding = user.profile.stara_onboarding;
        const record = onboardingRecord(body, completedAt);

        if (body.mode === 'tenant_addendum') {
          if (!body.tenant_id) {
            sendJson(res, 400, { error: 'tenant_id is required' });
            return;
          }
          onboarding.tenant_addenda[body.tenant_id] = record;
        } else {
          onboarding.account = record;
        }
        onboarding.updated_at = completedAt;
        sendJson(res, 200, { user, assurance: assuranceFor(req) });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (url.pathname === '/v1/orgs/access-options' && req.method === 'GET') {
      sendJson(res, 200, {
        role_bundles: [
          { key: 'owner', label: 'Owner', can_manage_org: true },
          { key: 'admin', label: 'Admin', can_manage_org: true },
          { key: 'member', label: 'Member', can_manage_org: false },
        ],
        scope_options: [],
      });
      return;
    }

    if (url.pathname === '/v1/orgs' && req.method === 'GET') {
      sendJson(res, 200, { active_tenant_id: null, orgs: [] });
      return;
    }

    if (/^\/v1\/orgs\/[^/]+\/teams$/.test(url.pathname) && req.method === 'GET') {
      sendJson(res, 200, { teams: [] });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });
}

function startFakeStaraApiServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = Number(options.port ?? DEFAULT_PORT);
  const server = createFakeStaraApiServer();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

if (require.main === module) {
  const host = process.env.E2E_STARA_API_HOST || DEFAULT_HOST;
  const port = Number(process.env.E2E_STARA_API_PORT || DEFAULT_PORT);
  startFakeStaraApiServer({ host, port })
    .then((server) => {
      console.log(`[e2e] fake Stara API listening on http://${host}:${port}`);
      const close = () => server.close(() => process.exit(0));
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    })
    .catch((error) => {
      console.error('[e2e] Failed to start fake Stara API:', error);
      process.exit(1);
    });
}

module.exports = {
  createFakeStaraApiServer,
  startFakeStaraApiServer,
};
