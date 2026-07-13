const mockLegacyMiddleware = jest.fn();
const mockCanonicalMiddleware = jest.fn();
const mockGetDeploymentSkillById = jest.fn();
const mockCanonicalSkillsEnabled = jest.fn();

jest.mock('./canAccessResource', () => ({
  canAccessResource: jest.fn(() => mockLegacyMiddleware),
}));

jest.mock('./canonicalSkillAccess', () => ({
  checkCanonicalSkillRouteAccess: (...args) => mockCanonicalMiddleware(...args),
}));

jest.mock('~/models', () => ({ getSkillById: jest.fn() }));
jest.mock('~/models/canonicalSkills', () => ({
  canonicalSkillsEnabled: () => mockCanonicalSkillsEnabled(),
}));
jest.mock('@librechat/api', () => ({
  getDeploymentSkillById: (...args) => mockGetDeploymentSkillById(...args),
}));

const { canAccessSkillResource } = require('./canAccessSkillResource');

describe('canAccessSkillResource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanonicalSkillsEnabled.mockReturnValue(true);
    mockGetDeploymentSkillById.mockReturnValue(null);
  });

  it('routes canonical UUIDs through Postgres-backed access checks', () => {
    const { req, res, next } = requestContext();
    req.params.id = '22222222-2222-4222-8222-222222222222';

    canAccessSkillResource({ requiredPermission: 1 })(req, res, next);

    expect(mockCanonicalMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        skillId: '22222222-2222-4222-8222-222222222222',
        requiredPermission: 1,
      }),
    );
    expect(mockLegacyMiddleware).not.toHaveBeenCalled();
  });

  it('preserves the legacy ACL path when canonical skills are disabled', () => {
    mockCanonicalSkillsEnabled.mockReturnValue(false);
    const { req, res, next } = requestContext();
    req.params.id = '507f1f77bcf86cd799439011';

    canAccessSkillResource({ requiredPermission: 1 })(req, res, next);

    expect(mockLegacyMiddleware).toHaveBeenCalledWith(req, res, next);
  });

  it('keeps deployment skills read-only', () => {
    mockGetDeploymentSkillById.mockReturnValue({
      _id: '507f1f77bcf86cd799439011',
      name: 'deployment-skill',
    });
    const { req, res, next } = requestContext();
    req.params.id = '507f1f77bcf86cd799439011';

    canAccessSkillResource({ requiredPermission: 2 })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

function requestContext() {
  const req = { params: {}, user: { id: 'user_maya' } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}
