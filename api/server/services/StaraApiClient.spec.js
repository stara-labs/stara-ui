jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const {
  getCanonicalGatewayContext,
  getCanonicalRequestUser,
  isCanonicalIdentityContextEnabled,
  requireCanonicalGatewayContext,
  resolveCanonicalRequestUser,
  runWithCanonicalRequestUser,
} = require('./StaraApiClient');

const originalApiUrl = process.env.STARA_API_URL;
const originalCanonicalIdentity = process.env.STARA_CANONICAL_IDENTITY_CONTEXT;
const originalCanonicalWorkspace = process.env.STARA_CANONICAL_WORKSPACE;
const originalIdentityPlatformAuth = process.env.STARA_IDENTITY_PLATFORM_AUTH;

describe('StaraApiClient canonical request identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_API_URL = 'http://stara-api:3081';
    process.env.STARA_CANONICAL_IDENTITY_CONTEXT = 'true';
    delete process.env.STARA_CANONICAL_WORKSPACE;
    delete process.env.STARA_IDENTITY_PLATFORM_AUTH;
  });

  afterAll(() => {
    restoreEnv('STARA_API_URL', originalApiUrl);
    restoreEnv('STARA_CANONICAL_IDENTITY_CONTEXT', originalCanonicalIdentity);
    restoreEnv('STARA_CANONICAL_WORKSPACE', originalCanonicalWorkspace);
    restoreEnv('STARA_IDENTITY_PLATFORM_AUTH', originalIdentityPlatformAuth);
  });

  it('replaces a stale compatibility tenant with the active Postgres membership in request memory', async () => {
    mockAccount({
      active_tenant_id: 'tenant_acme',
      memberships: [activeMembership()],
    });
    const user = makeUser({ tenantId: 'tenant_stale' });

    await expect(resolveCanonicalRequestUser(user)).resolves.toBe(user);

    expect(user.tenantId).toBe('tenant_acme');
    expect(getCanonicalGatewayContext(user)).toEqual({
      tenant_id: 'tenant_acme',
      tenant_uuid: '11111111-1111-5111-8111-111111111111',
      actor_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      identity_subject: 'librechat:user_owner',
      identity_email: 'maya@example.com',
      role_key: 'owner',
      scope: ['org:acme'],
      grants: ['stara.memory.read'],
      assurance: { email_verified: true, mfa_enrolled: true },
    });
    expect(JSON.stringify(user)).not.toContain('stara.memory.read');
    expect(fetch).toHaveBeenCalledWith(
      'http://stara-api:3081/v1/me',
      expect.objectContaining({
        headers: expect.not.objectContaining({ 'x-stara-tenant-id': expect.anything() }),
      }),
    );
  });

  it('clears a stale tenant when the canonical account has no active selection', async () => {
    mockAccount({ active_tenant_id: null, memberships: [activeMembership()] });
    const user = makeUser({ tenantId: 'tenant_stale' });

    await resolveCanonicalRequestUser(user);

    expect(user.tenantId).toBeUndefined();
    expect(getCanonicalGatewayContext(user)).toBeUndefined();
  });

  it('allows an unsynchronized identity to reach onboarding without retaining Mongo tenant state', async () => {
    mockJson({ error: 'identity_not_synced', message: 'Not synchronized' }, 404);
    const user = makeUser({ tenantId: 'tenant_stale' });

    await expect(resolveCanonicalRequestUser(user)).resolves.toBe(user);

    expect(user.tenantId).toBeUndefined();
    expect(getCanonicalGatewayContext(user)).toBeUndefined();
  });

  it('fails closed for a missing or inconsistent canonical active-membership contract', async () => {
    mockAccount({ active_tenant_id: 'tenant_acme', memberships: [] });
    await expect(resolveCanonicalRequestUser(makeUser())).rejects.toMatchObject({ status: 503 });

    mockAccount({ memberships: [activeMembership()] });
    await expect(resolveCanonicalRequestUser(makeUser())).rejects.toMatchObject({ status: 503 });
  });

  it('inherits workspace mode but supports an explicit transition override', async () => {
    delete process.env.STARA_CANONICAL_IDENTITY_CONTEXT;
    process.env.STARA_CANONICAL_WORKSPACE = 'true';
    expect(isCanonicalIdentityContextEnabled()).toBe(true);

    process.env.STARA_CANONICAL_IDENTITY_CONTEXT = 'false';
    expect(isCanonicalIdentityContextEnabled()).toBe(false);
    const user = makeUser({ tenantId: 'legacy-only' });
    await expect(resolveCanonicalRequestUser(user)).resolves.toBe(user);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('always enables canonical request identity for Identity Platform auth', () => {
    process.env.STARA_CANONICAL_IDENTITY_CONTEXT = 'false';
    process.env.STARA_IDENTITY_PLATFORM_AUTH = 'true';

    expect(isCanonicalIdentityContextEnabled()).toBe(true);
  });

  it('provides an isolated request actor and rejects actor mismatches', async () => {
    const user = makeUser({ tenantId: 'tenant_acme' });

    await runWithCanonicalRequestUser(user, async () => {
      expect(getCanonicalRequestUser('user_owner')).toBe(user);
      expect(() => getCanonicalRequestUser('other_user')).toThrow(
        'Canonical request identity does not match the requested actor',
      );
    });

    expect(() => getCanonicalRequestUser('user_owner')).toThrow(
      'Canonical request identity is unavailable',
    );
  });

  it('fails closed when canonical Gateway authority is incomplete or mismatched', async () => {
    mockAccount({
      active_tenant_id: 'tenant_acme',
      memberships: [activeMembership({ scope_ids: [] })],
    });
    await expect(resolveCanonicalRequestUser(makeUser())).rejects.toMatchObject({
      status: 503,
      code: 'canonical_identity_context_unavailable',
    });

    mockAccount({
      active_tenant_id: 'tenant_acme',
      user: canonicalUser({ identity_subject: 'spoofed-subject' }),
      memberships: [activeMembership()],
    });
    await expect(resolveCanonicalRequestUser(makeUser())).rejects.toMatchObject({
      status: 503,
      code: 'canonical_identity_context_unavailable',
    });
  });

  it('requires an active canonical tenant before Gateway use', () => {
    expect(() => requireCanonicalGatewayContext(makeUser())).toThrow(
      'Select an active Stara organization',
    );
  });
});

function activeMembership(overrides = {}) {
  return {
    tenant_id: '11111111-1111-5111-8111-111111111111',
    tenant_key: 'tenant_acme',
    tenant_slug: 'acme',
    tenant_name: 'Acme',
    tenant_status: 'active',
    role_key: 'owner',
    scope_ids: ['org:acme'],
    membership_status: 'active',
    mcp_grants: ['stara.memory.read'],
    ...overrides,
  };
}

function mockAccount(overrides) {
  mockJson({
    user: canonicalUser(),
    assurance: {
      email_verified: true,
      mfa_enrolled: true,
      regulated_surfaces_ready: true,
    },
    ...overrides,
  });
}

function canonicalUser(overrides = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    identity_subject: 'librechat:user_owner',
    email: 'maya@example.com',
    display_name: 'Maya',
    status: 'active',
    email_verified: true,
    mfa_enrolled: true,
    profile: {},
    ...overrides,
  };
}

function mockJson(payload, status = 200) {
  fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  });
}

function makeUser(overrides = {}) {
  return {
    id: 'user_owner',
    email: 'maya@example.com',
    name: 'Maya',
    emailVerified: true,
    twoFactorEnabled: true,
    ...overrides,
  };
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
