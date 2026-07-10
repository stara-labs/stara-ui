const mockVerify = jest.fn();
const mockGetUserById = jest.fn();
const mockFindSession = jest.fn();

jest.mock('jsonwebtoken', () => ({ verify: (...args) => mockVerify(...args) }));
jest.mock('@librechat/api', () => ({ isEnabled: (v) => v === 'true' || v === true }), {
  virtual: true,
});
jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { warn: jest.fn(), error: jest.fn() },
}));
jest.mock('~/models', () => ({
  getUserById: (...args) => mockGetUserById(...args),
  findSession: (...args) => mockFindSession(...args),
}));

const optionalShareFileAuth = require('./optionalShareFileAuth');
const { getTenantId, SYSTEM_TENANT_ID } = require('@librechat/data-schemas');

const run = async (req) => {
  const next = jest.fn();
  await optionalShareFileAuth(req, {}, next);
  return next;
};

const captureSystemContext = (mockFn, value) => {
  const tenantIds = [];
  mockFn.mockImplementation(async () => {
    tenantIds.push(getTenantId());
    return value;
  });
  return tenantIds;
};

describe('optionalShareFileAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_REFRESH_SECRET = 'test-secret';
  });

  it('short-circuits when a bearer user is already set (no cookie work)', async () => {
    const req = { user: { id: 'u1' }, headers: { cookie: 'refreshToken=x' } };
    const next = await run(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('resolves the viewer from a valid refreshToken cookie with a live session', async () => {
    mockVerify.mockReturnValue({ id: 'viewer-1' });
    // These model reads must run in system context because shared-file requests
    // arrive before the share tenant is known.
    const sessionTenantIds = captureSystemContext(mockFindSession, { _id: 'session-1' });
    const userTenantIds = captureSystemContext(mockGetUserById, { _id: 'viewer-1', role: 'USER' });
    const req = { headers: { cookie: 'refreshToken=good.jwt' } };
    const next = await run(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith('good.jwt', 'test-secret');
    expect(mockFindSession).toHaveBeenCalledWith({ userId: 'viewer-1', refreshToken: 'good.jwt' });
    expect(sessionTenantIds).toEqual([SYSTEM_TENANT_ID]);
    expect(userTenantIds).toEqual([SYSTEM_TENANT_ID]);
    expect(req.user).toMatchObject({ id: 'viewer-1', role: 'USER' });
  });

  it('defaults the role to USER when the record has none', async () => {
    mockVerify.mockReturnValue({ id: 'viewer-2' });
    mockFindSession.mockResolvedValue({ _id: 'session-2' });
    mockGetUserById.mockResolvedValue({ _id: 'viewer-2' });
    const req = { headers: { cookie: 'refreshToken=good.jwt' } };
    await run(req);
    expect(req.user.role).toBe('USER');
  });

  it('leaves req.user unset when there is no cookie', async () => {
    const req = { headers: {} };
    const next = await run(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('leaves req.user unset when the refresh token has no live session', async () => {
    mockVerify.mockReturnValue({ id: 'viewer-3' });
    const sessionTenantIds = captureSystemContext(mockFindSession, null);
    const req = { headers: { cookie: 'refreshToken=revoked.jwt' } };
    const next = await run(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expect(mockFindSession).toHaveBeenCalledWith({
      userId: 'viewer-3',
      refreshToken: 'revoked.jwt',
    });
    expect(sessionTenantIds).toEqual([SYSTEM_TENANT_ID]);
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('leaves req.user unset when the token is invalid', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const req = { headers: { cookie: 'refreshToken=bad' } };
    const next = await run(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeUndefined();
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it('uses the signed openid_user_id cookie only for active OpenID-reuse sessions', async () => {
    process.env.OPENID_REUSE_TOKENS = 'true';
    mockVerify.mockReturnValue({ id: 'oidc-1' });
    mockGetUserById.mockResolvedValue({ _id: 'oidc-1', role: 'USER' });
    const req = {
      headers: {
        cookie: 'token_provider=openid; refreshToken=stored-refresh; openid_user_id=signed.jwt',
      },
      session: { openidTokens: { refreshToken: 'stored-refresh' } },
    };
    await run(req);
    expect(mockVerify).toHaveBeenCalledWith('signed.jwt', 'test-secret');
    expect(mockFindSession).not.toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: 'oidc-1' });
    delete process.env.OPENID_REUSE_TOKENS;
  });

  it('leaves req.user unset for OpenID-reuse cookies without an active matching session', async () => {
    process.env.OPENID_REUSE_TOKENS = 'true';
    mockVerify.mockReturnValue({ id: 'oidc-2' });
    const req = {
      headers: {
        cookie: 'token_provider=openid; refreshToken=stale-refresh; openid_user_id=signed.jwt',
      },
      session: { openidTokens: { refreshToken: 'current-refresh' } },
    };
    await run(req);
    expect(req.user).toBeUndefined();
    expect(mockGetUserById).not.toHaveBeenCalled();
    delete process.env.OPENID_REUSE_TOKENS;
  });
});
