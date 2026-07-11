jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');

jest.mock('mongoose', () => ({
  Types: {
    ObjectId: {
      isValid: jest.fn(() => false),
    },
  },
  models: {},
}));

jest.mock('librechat-data-provider', () => ({
  PrincipalType: {
    USER: 'user',
  },
}));

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: {
    ACCESS_ADMIN: 'access_admin',
    MANAGE_USERS: 'manage_users',
    MANAGE_GROUPS: 'manage_groups',
    MANAGE_ROLES: 'manage_roles',
    MANAGE_CONFIGS: 'manage_configs',
    ASSIGN_CONFIGS: 'assign_configs',
    MANAGE_AGENTS: 'manage_agents',
    MANAGE_MCP_SERVERS: 'manage_mcp_servers',
    MANAGE_PROMPTS: 'manage_prompts',
    MANAGE_SKILLS: 'manage_skills',
    MANAGE_SHARED_LINKS: 'manage_shared_links',
    MANAGE_ASSISTANTS: 'manage_assistants',
    READ_USAGE: 'read_usage',
    READ_AUDIT_LOG: 'read_audit_log',
  },
  hashToken: jest.fn(async (token) => `hash:${token}`),
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
  runAsSystem: jest.fn((fn) => fn()),
}));

jest.mock('~/models', () => ({
  createTenant: jest.fn(async (data) => ({ ...data, createdAt: '2026-07-11T00:00:00.000Z' })),
  updateTenant: jest.fn(async (_query, data) => ({
    ...data,
    updatedAt: '2026-07-11T00:00:00.000Z',
  })),
  findTenant: jest.fn(),
  listTenants: jest.fn(),
  findUsers: jest.fn(async () => []),
  getUserById: jest.fn(),
  updateUser: jest.fn(),
  upsertTenantMembership: jest.fn(async (data) => ({
    ...data,
    createdAt: '2026-07-11T00:00:00.000Z',
  })),
  updateTenantMembership: jest.fn(async (_query, data) => data),
  findTenantMembership: jest.fn(),
  listTenantMemberships: jest.fn(),
  setDefaultTenantMembership: jest.fn(),
  findTokens: jest.fn(async () => []),
  createToken: jest.fn(),
  findToken: jest.fn(),
  deleteTokens: jest.fn(),
  revokeCapability: jest.fn(),
  grantCapability: jest.fn(),
}));

const db = require('~/models');
const {
  acceptInviteController,
  createInviteController,
  createOrganizationController,
} = require('./StaraOrganizationsController');

const originalStaraApiUrl = process.env.STARA_API_URL;
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;

describe('StaraOrganizationsController stara-api migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STARA_API_URL = 'http://stara-api:3081';
    process.env.APP_PUBLIC_URL = 'https://control-plane.stara.co';
    process.env.RESEND_API_KEY = '';
    process.env.RESEND_FROM_EMAIL = '';
    seedContextMocks();
  });

  afterAll(() => {
    restoreEnv('STARA_API_URL', originalStaraApiUrl);
    restoreEnv('RESEND_API_KEY', originalResendApiKey);
    restoreEnv('RESEND_FROM_EMAIL', originalResendFromEmail);
  });

  it('creates organizations through stara-api and mirrors tenant compatibility fields', async () => {
    mockFetchJson([
      {
        org: apiOrg('draft'),
        membership: apiMember('owner'),
        policy_config: { regulated_data_classes: ['pii', 'phi', 'financial', 'confidential'] },
      },
      { org: apiOrg('active') },
      { orgs: [{ org: apiOrg('active'), membership: apiMember('owner') }] },
    ]);

    const req = makeReq({ body: { name: 'Acme Health' } });
    const res = makeRes();

    await createOrganizationController(req, res);

    expect(fetch).toHaveBeenCalledWith(
      'http://stara-api:3081/v1/orgs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-stara-user-id': 'user_owner',
          'x-stara-actor-email': 'maya@example.com',
          'x-stara-email-verified': 'true',
          'x-stara-mfa-enrolled': 'true',
        }),
        body: JSON.stringify({ name: 'Acme Health' }),
      }),
    );
    expect(db.createTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant_acme-health',
        name: 'Acme Health',
        slug: 'acme-health',
      }),
    );
    expect(db.upsertTenantMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_owner',
        tenantId: 'tenant_acme-health',
        roleKey: 'owner',
        source: 'stara',
      }),
    );
    expect(db.updateUser).toHaveBeenCalledWith('user_owner', { tenantId: 'tenant_acme-health' });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('creates canonical stara-api invites and returns the existing UI fallback link shape', async () => {
    db.findTenant.mockResolvedValue(apiOrgAsTenant());
    db.findTenantMembership.mockResolvedValue(localMembership('owner'));
    mockFetchJson([
      {
        invite: {
          invite_id: 'invite_1',
          tenant_id: 'tenant_acme-health',
          email: 'lee@example.com',
          role_key: 'member',
          scope_ids: ['memory'],
          status: 'pending',
          expires_at: '2026-07-18T00:00:00.000Z',
          created_at: '2026-07-11T00:00:00.000Z',
        },
        token: 'invite_token_000000000000000000000001',
      },
      { orgs: [{ org: apiOrg('active'), membership: apiMember('owner') }] },
    ]);

    const req = makeReq({
      params: { tenantId: 'tenant_acme-health' },
      body: { email: 'lee@example.com', roleKey: 'member', scopeIds: ['memory'] },
      user: { tenantId: 'tenant_acme-health' },
    });
    const res = makeRes();

    await createInviteController(req, res);

    expect(fetch).toHaveBeenCalledWith(
      'http://stara-api:3081/v1/orgs/tenant_acme-health/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'lee@example.com',
          role_key: 'member',
          scope_ids: ['memory'],
          expires_in_days: 7,
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].inviteLink).toContain('invite_token_000000000000000000000001');
  });

  it('accepts stara-api invites and mirrors accepted membership locally', async () => {
    mockFetchJson([
      {
        org: apiOrg('active'),
        membership: {
          ...apiMember('member'),
          user_id: 'user_member',
          email: 'lee@example.com',
          display_name: 'Lee',
        },
        invite: { created_by_user_id: 'user_owner' },
      },
      {
        orgs: [
          { org: apiOrg('active'), membership: { ...apiMember('member'), user_id: 'user_member' } },
        ],
      },
    ]);

    const req = makeReq({
      body: { token: 'invite_token_000000000000000000000001' },
      user: {
        _id: 'user_member',
        id: 'user_member',
        email: 'lee@example.com',
        name: 'Lee',
        emailVerified: true,
        twoFactorEnabled: true,
      },
    });
    db.getUserById.mockResolvedValue({
      ...req.user,
      tenantId: 'tenant_acme-health',
    });
    db.listTenantMemberships.mockResolvedValue([localMembership('member', 'user_member')]);

    const res = makeRes();
    await acceptInviteController(req, res);

    expect(fetch).toHaveBeenCalledWith(
      'http://stara-api:3081/v1/orgs/invites/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'invite_token_000000000000000000000001' }),
      }),
    );
    expect(db.upsertTenantMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_member',
        tenantId: 'tenant_acme-health',
        roleKey: 'member',
        source: 'stara',
      }),
    );
    expect(db.updateUser).toHaveBeenCalledWith('user_member', { tenantId: 'tenant_acme-health' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

function seedContextMocks() {
  db.getUserById.mockResolvedValue(makeUser());
  db.findTenant.mockResolvedValue(null);
  db.listTenants.mockResolvedValue([apiOrgAsTenant()]);
  db.findTenantMembership.mockResolvedValue(localMembership('owner'));
  db.listTenantMemberships.mockResolvedValue([localMembership('owner')]);
}

function mockFetchJson(payloads) {
  for (const payload of payloads) {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    });
  }
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
    emailVerified: true,
    twoFactorEnabled: true,
    ...overrides,
  };
}

function apiOrg(status = 'active') {
  return {
    tenant_id: 'tenant_acme-health',
    slug: 'acme-health',
    name: 'Acme Health',
    status,
    created_by_user_id: 'user_owner',
    created_at: '2026-07-11T00:00:00.000Z',
  };
}

function apiOrgAsTenant() {
  return {
    tenantId: 'tenant_acme-health',
    slug: 'acme-health',
    name: 'Acme Health',
    status: 'active',
  };
}

function apiMember(roleKey = 'owner') {
  return {
    tenant_id: 'tenant_acme-health',
    user_id: 'user_owner',
    email: 'maya@example.com',
    display_name: 'Maya',
    role_key: roleKey,
    scope_ids: ['memory'],
    status: 'active',
    joined_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  };
}

function localMembership(roleKey = 'owner', userId = 'user_owner') {
  return {
    _id: `membership_${userId}`,
    userId,
    tenantId: 'tenant_acme-health',
    orgName: 'Acme Health',
    roleKey,
    roleLabel: roleKey === 'owner' ? 'Owner' : 'Member',
    status: 'active',
    isDefault: true,
    source: 'stara',
    scopeIds: ['memory'],
    groupIds: [],
  };
}

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
