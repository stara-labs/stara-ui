import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMethods, createModels, runAsSystem } from '..';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;
let TenantMembership: mongoose.Model<unknown>;
let Token: mongoose.Model<unknown>;

const userId = new mongoose.Types.ObjectId().toString();

jest.setTimeout(120000);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
  TenantMembership = mongoose.models.TenantMembership;
  Token = mongoose.models.Token;
  await TenantMembership.syncIndexes();
  await Token.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  await runAsSystem(async () => {
    await TenantMembership.deleteMany({});
    await Token.deleteMany({});
  });
});

describe('tenant membership methods', () => {
  it('upserts and lists account-level tenant memberships', async () => {
    const membership = await methods.upsertTenantMembership({
      userId,
      tenantId: 'tenant-alpha',
      orgName: 'Alpha Health',
      roleLabel: 'Care lead',
      status: 'active',
      isDefault: true,
      scopeIds: ['memory:clinical'],
      groupIds: ['care-team'],
    });

    expect(membership.tenantId).toBe('tenant-alpha');
    expect(membership.isDefault).toBe(true);

    const memberships = await methods.listTenantMemberships({
      userId,
      status: ['active'],
    });

    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      tenantId: 'tenant-alpha',
      orgName: 'Alpha Health',
      roleLabel: 'Care lead',
      scopeIds: ['memory:clinical'],
      groupIds: ['care-team'],
    });
  });

  it('keeps only one default tenant membership per account', async () => {
    await methods.upsertTenantMembership({
      userId,
      tenantId: 'tenant-alpha',
      orgName: 'Alpha',
      isDefault: true,
    });
    await methods.upsertTenantMembership({
      userId,
      tenantId: 'tenant-beta',
      orgName: 'Beta',
      isDefault: true,
    });

    const memberships = await methods.listTenantMemberships({ userId, status: ['active'] });
    const defaults = memberships.filter((membership) => membership.isDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0].tenantId).toBe('tenant-beta');
  });
});

describe('stara tenant invite token queries', () => {
  it('finds and deletes typed invite tokens without requiring raw token lookup', async () => {
    const token = await runAsSystem(async () =>
      methods.createToken({
        userId,
        email: 'invitee@example.com',
        type: 'stara_tenant_invite',
        token: 'raw-secret-token',
        expiresIn: 3600,
        tenantId: 'tenant-alpha',
        metadata: {
          orgName: 'Alpha Health',
          roleLabel: 'Reviewer',
        },
      }),
    );

    const byId = await runAsSystem(async () =>
      methods.findToken({
        _id: token._id,
        type: 'stara_tenant_invite',
        tenantId: 'tenant-alpha',
      }),
    );
    const byEmail = await runAsSystem(async () =>
      methods.findTokens({
        email: 'invitee@example.com',
        type: 'stara_tenant_invite',
      }),
    );

    expect(byId?.tenantId).toBe('tenant-alpha');
    expect(byEmail.map((invite) => invite.tenantId)).toEqual(['tenant-alpha']);

    await runAsSystem(async () => methods.deleteTokens({ _id: token._id }));
    const remaining = await runAsSystem(async () =>
      methods.findTokens({ email: 'invitee@example.com', type: 'stara_tenant_invite' }),
    );

    expect(remaining).toEqual([]);
  });
});
