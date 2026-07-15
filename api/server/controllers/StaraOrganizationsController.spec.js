jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

const {
  acceptInviteController,
  activateOrganizationController,
  createInviteController,
  createOrganizationController,
  getOrganizationsContextController,
} = require('./StaraOrganizationsController');

const originalStaraApiUrl = process.env.STARA_API_URL;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;

describe('StaraOrganizationsController canonical API proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_API_URL = 'http://stara-api:3081';
    process.env.APP_PUBLIC_URL = 'https://control-plane.stara.co';
    process.env.RESEND_API_KEY = '';
    process.env.RESEND_FROM_EMAIL = '';
  });

  afterAll(() => {
    restoreEnv('STARA_API_URL', originalStaraApiUrl);
    restoreEnv('RESEND_API_KEY', originalResendApiKey);
    restoreEnv('RESEND_FROM_EMAIL', originalResendFromEmail);
  });

  it('loads organization context entirely from stara-api without a Mongo profile mirror', async () => {
    mockContext();
    const res = makeRes();

    await getOrganizationsContextController(makeReq(), res);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://stara-api:3081/v1/orgs/access-options',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-stara-identity-subject': 'librechat:user_owner',
          'x-stara-actor-email': 'maya@example.com',
          'x-stara-email-verified': 'true',
          'x-stara-mfa-enrolled': 'true',
        }),
      }),
    );
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('x-stara-user-id');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      activeOrg: { tenantId: 'tenant_acme-health', roleLabel: 'Owner' },
      permissions: { canManageMembers: true, canManageTeams: true },
      scopedAccess: { scopeIds: ['memory'], groupIds: ['team_ops'] },
    });
    expect(res.json.mock.calls[0][0].members[0]).toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      groupIds: ['team_ops'],
    });
  });

  it('creates and activates an org without writing duplicate tenant or membership models', async () => {
    mockFetchJson({ org: apiOrg('draft'), membership: apiMember('owner') });
    mockFetchJson({ org: apiOrg('active'), active_tenant_id: 'tenant_acme-health' });
    mockContext();
    const res = makeRes();

    const businessProfile = {
      business_summary: 'Acme coordinates regulated health operations.',
      primary_outcomes: ['Reduce onboarding time'],
      critical_workflows: ['Customer onboarding'],
      operating_constraints: [],
    };
    await createOrganizationController(
      makeReq({ body: { name: 'Acme Health', business_profile: businessProfile } }),
      res,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://stara-api:3081/v1/orgs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Acme Health', business_profile: businessProfile }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://stara-api:3081/v1/orgs/tenant_acme-health/activate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-stara-tenant-id': 'tenant_acme-health' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('creates canonical invites and keeps only the fallback delivery response in the UI layer', async () => {
    mockFetchJson({
      invite: apiInvite(),
      token: 'invite_token_000000000000000000000001',
    });
    mockContext();
    const res = makeRes();

    await createInviteController(
      makeReq({
        params: { tenantId: 'tenant_acme-health' },
        body: { email: 'lee@example.com', roleKey: 'member', scopeIds: [] },
        user: makeUser({ tenantId: 'tenant_acme-health' }),
      }),
      res,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://stara-api:3081/v1/orgs/tenant_acme-health/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'lee@example.com',
          role_key: 'member',
          scope_ids: [],
          expires_in_days: 7,
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      invite: { id: '33333333-3333-4333-8333-333333333333', email: 'lee@example.com' },
      delivery: { sent: false, reason: 'resend_not_configured' },
    });
    expect(res.json.mock.calls[0][0].inviteLink).toContain('invite_token_000000000000000000000001');
  });

  it('accepts invitations through stara-api without writing compatibility state', async () => {
    mockFetchJson({
      org: apiOrg('active'),
      active_tenant_id: 'tenant_acme-health',
      membership: apiMember('member'),
    });
    mockContext('member');
    const res = makeRes();

    await acceptInviteController(
      makeReq({
        body: { token: 'invite_token_000000000000000000000001' },
        user: makeUser({
          _id: 'user_member',
          id: 'user_member',
          email: 'lee@example.com',
          name: 'Lee',
        }),
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('lets a regular member select an active organization through the canonical API', async () => {
    mockFetchJson({ org: apiOrg('active'), active_tenant_id: 'tenant_acme-health' });
    mockContext('member');
    const res = makeRes();

    await activateOrganizationController(
      makeReq({
        params: { tenantId: 'tenant_acme-health' },
        user: makeUser({ tenantId: 'tenant_previous', email: 'lee@example.com', name: 'Lee' }),
      }),
      res,
    );

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://stara-api:3081/v1/orgs/tenant_acme-health/activate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not treat a legacy Mongo tenant as the canonical active organization', async () => {
    mockFetchJson(accessOptions());
    mockFetchJson({
      active_tenant_id: null,
      orgs: [{ org: apiOrg('active'), membership: apiMember('owner') }],
    });
    const res = makeRes();

    await getOrganizationsContextController(makeReq(), res);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      activeOrg: null,
      members: [],
      teams: [],
      scopedAccess: { tenantId: null },
    });
  });

  it('fails closed when stara-api is not configured', async () => {
    delete process.env.STARA_API_URL;
    const res = makeRes();

    await getOrganizationsContextController(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function mockContext(roleKey = 'owner') {
  mockFetchJson(accessOptions());
  mockFetchJson({
    active_tenant_id: 'tenant_acme-health',
    orgs: [{ org: apiOrg('active'), membership: apiMember(roleKey) }],
  });
  mockFetchJson({ members: [apiMember(roleKey)] });
  mockFetchJson({ teams: [apiTeam()] });
  if (roleKey === 'owner' || roleKey === 'admin') {
    mockFetchJson({ invites: [apiInvite()] });
  }
}

function mockFetchJson(payload, status = 200) {
  fetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  });
}

function makeReq(overrides = {}) {
  return {
    params: {},
    body: {},
    user: makeUser(overrides.user),
    ...overrides,
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
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

function accessOptions() {
  return {
    role_bundles: [
      role('owner', 'Owner', true),
      role('admin', 'Admin', true),
      role('member', 'Member', false),
      role('viewer', 'Viewer', false),
    ],
    scope_options: [
      { id: 'memory', label: 'Memory', description: 'Tenant memory.' },
      { id: 'agents', label: 'Agents', description: 'Tenant agents.' },
    ],
  };
}

function role(key, label, canManage) {
  return {
    key,
    label,
    description: `${label} role`,
    can_manage_org: canManage,
  };
}

function apiOrg(status = 'active') {
  return {
    tenant_id: 'tenant_acme-health',
    slug: 'acme-health',
    name: 'Acme Health',
    status,
    created_by_user_id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-07-11T00:00:00.000Z',
  };
}

function apiMember(roleKey = 'owner') {
  return {
    tenant_id: 'tenant_acme-health',
    user_id: '11111111-1111-4111-8111-111111111111',
    email: roleKey === 'member' ? 'lee@example.com' : 'maya@example.com',
    display_name: roleKey === 'member' ? 'Lee' : 'Maya',
    role_key: roleKey,
    scope_ids: ['memory'],
    status: 'active',
    joined_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  };
}

function apiTeam() {
  return {
    team_id: 'team_ops',
    tenant_id: 'tenant_acme-health',
    name: 'Operations',
    description: 'Customer operations',
    member_ids: ['11111111-1111-4111-8111-111111111111'],
    status: 'active',
    created_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  };
}

function apiInvite() {
  return {
    invite_id: '33333333-3333-4333-8333-333333333333',
    tenant_id: 'tenant_acme-health',
    email: 'lee@example.com',
    role_key: 'member',
    scope_ids: [],
    status: 'pending',
    created_at: '2026-07-11T00:00:00.000Z',
    expires_at: '2026-07-18T00:00:00.000Z',
  };
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
