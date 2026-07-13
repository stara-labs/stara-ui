jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const {
  acceptStaraTenantInviteController,
  activateStaraTenantController,
  getStaraOnboardingContextController,
  syncStaraIdentityController,
  saveStaraOnboardingController,
} = require('./StaraOnboardingController');

const originalStaraApiUrl = process.env.STARA_API_URL;

describe('StaraOnboardingController canonical API proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_API_URL = 'http://stara-api:3081';
  });

  afterAll(() => restoreEnv('STARA_API_URL', originalStaraApiUrl));

  it('builds onboarding context from canonical profile, org, membership, and team state', async () => {
    mockContext();
    const res = makeRes();

    await getStaraOnboardingContextController(makeReq(), res);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://stara-api:3081/v1/identity/sync',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-stara-identity-subject': 'librechat:user_owner',
          'x-stara-email-verified': 'true',
          'x-stara-mfa-enrolled': 'true',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      account: { completed: true, onboarding: { mode: 'business_join' } },
      activeMembership: {
        tenantId: 'tenant_acme',
        roleLabel: 'Owner',
        groupIds: ['44444444-4444-4444-8444-444444444444'],
      },
      access: {
        tenantId: 'tenant_acme',
        scopes: ['memory'],
        groups: [{ id: '44444444-4444-4444-8444-444444444444', source: 'stara' }],
      },
      pendingInvites: [],
      requiresOnboarding: false,
      requiresTenantAddendum: true,
    });
  });

  it('synchronizes a verified browser identity without loading organization context', async () => {
    mockFetchJson(accountResponse());
    const res = makeRes();

    await syncStaraIdentityController(makeReq(), res);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://stara-api:3081/v1/identity/sync',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ display_name: 'Maya' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.any(Object) }));
  });

  it('stores bounded onboarding answers through stara-api', async () => {
    mockFetchJson(accountResponse());
    mockContext({ tenantAddendumComplete: true });
    const res = makeRes();

    await saveStaraOnboardingController(
      makeReq({
        body: {
          mode: 'tenant_addendum',
          tenantId: 'tenant_acme',
          recommendedStart: 'approvals',
          readinessScore: 110.4,
          responses: { governance: 'review', ignored: { nested: true } },
        },
      }),
      res,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://stara-api:3081/v1/me/onboarding',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          mode: 'tenant_addendum',
          tenant_id: 'tenant_acme',
          recommended_start: 'approvals',
          readiness_score: 100,
          responses: { governance: 'review' },
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('hides organization state without assurance and does not write compatibility state', async () => {
    mockFetchJson(accountResponse({ ready: false }));
    const res = makeRes();

    await getStaraOnboardingContextController(makeReq(), res);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      memberships: [],
      activeMembership: null,
      access: { tenantId: null, groups: [], grants: [] },
    });
  });

  it('selects an organization through the canonical activate contract', async () => {
    mockFetchJson({ active_tenant_id: 'tenant_acme' });
    mockContext({ tenantAddendumComplete: true });
    const res = makeRes();

    await activateStaraTenantController(makeReq({ params: { tenantId: 'tenant_acme' } }), res);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://stara-api:3081/v1/orgs/tenant_acme/activate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects ID-only invitation acceptance in favor of the secure token link', async () => {
    const res = makeRes();

    await acceptStaraTenantInviteController(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function mockContext(options = {}) {
  mockFetchJson(accountResponse(options));
  mockFetchJson({
    role_bundles: [
      { key: 'owner', label: 'Owner', can_manage_org: true },
      { key: 'member', label: 'Member', can_manage_org: false },
    ],
  });
  mockFetchJson({
    active_tenant_id: 'tenant_acme',
    orgs: [{ org: apiOrg(), membership: apiMembership() }],
  });
  mockFetchJson({ teams: [apiTeam()] });
}

function accountResponse(options = {}) {
  const addenda = options.tenantAddendumComplete
    ? { tenant_acme: onboardingRecord('tenant_addendum') }
    : {};
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      profile: {
        stara_onboarding: {
          version: 1,
          account: onboardingRecord('business_join'),
          tenant_addenda: addenda,
          updated_at: '2026-07-12T00:00:00.000Z',
        },
      },
    },
    assurance: { regulated_surfaces_ready: options.ready ?? true },
  };
}

function onboardingRecord(mode) {
  return {
    completed_at: '2026-07-12T00:00:00.000Z',
    mode,
    recommended_start: 'memory',
    readiness_score: 80,
    responses: {},
    version: 1,
  };
}

function apiOrg() {
  return { tenant_id: 'tenant_acme', name: 'Acme', status: 'active' };
}

function apiMembership() {
  return {
    tenant_id: 'tenant_acme',
    user_id: '11111111-1111-4111-8111-111111111111',
    role_key: 'owner',
    scope_ids: ['memory'],
    status: 'active',
    joined_at: '2026-07-12T00:00:00.000Z',
    updated_at: '2026-07-12T00:00:00.000Z',
  };
}

function apiTeam() {
  return {
    team_id: '44444444-4444-4444-8444-444444444444',
    name: 'Operations',
    description: 'Operations team',
    member_ids: ['11111111-1111-4111-8111-111111111111'],
  };
}

function mockFetchJson(payload, status = 200) {
  fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  });
}

function makeReq(overrides = {}) {
  return { params: {}, body: {}, user: makeUser(overrides.user), ...overrides };
}

function makeUser(overrides = {}) {
  return {
    _id: 'user_owner',
    id: 'user_owner',
    email: 'maya@example.com',
    name: 'Maya',
    username: 'maya',
    tenantId: undefined,
    idOnTheSource: undefined,
    emailVerified: true,
    twoFactorEnabled: true,
    ...overrides,
  };
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
