jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('~/models/canonicalSkills', () => ({
  getCanonicalSkillAccess: jest.fn(),
  requiredCanonicalSkillPermissions: (permission, invoke) => {
    const required = [];
    if ((permission & 1) !== 0) required.push(invoke ? 'skill.invoke' : 'skill.read');
    if ((permission & 2) !== 0) required.push('skill.edit');
    if ((permission & 4) !== 0) required.push('skill.delete');
    if ((permission & 8) !== 0) required.push('skill.share');
    return required;
  },
}));

const { getCanonicalSkillAccess } = require('~/models/canonicalSkills');
const { checkCanonicalSkillRouteAccess } = require('./canonicalSkillAccess');

describe('canonical skill route access', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows reads and records canonical access', async () => {
    const access = { permissions: ['skill.read'], role_keys: ['viewer'], owner: false };
    getCanonicalSkillAccess.mockResolvedValue(access);
    const { req, res, next } = requestContext();

    await checkCanonicalSkillRouteAccess({
      req,
      res,
      next,
      skillId: '22222222-2222-4222-8222-222222222222',
      requiredPermission: 1,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.resourceAccess.canonicalAccess).toBe(access);
  });

  it('does not treat read permission as invoke permission', async () => {
    getCanonicalSkillAccess.mockResolvedValue({
      permissions: ['skill.read'],
      role_keys: ['viewer'],
      owner: false,
    });
    const { req, res, next } = requestContext();

    await checkCanonicalSkillRouteAccess({
      req,
      res,
      next,
      skillId: '22222222-2222-4222-8222-222222222222',
      requiredPermission: 1,
      invoke: true,
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps missing and inaccessible skills non-enumerable', async () => {
    const error = new Error('not found');
    error.status = 404;
    getCanonicalSkillAccess.mockRejectedValue(error);
    const { req, res, next } = requestContext();

    await checkCanonicalSkillRouteAccess({
      req,
      res,
      next,
      skillId: '22222222-2222-4222-8222-222222222222',
      requiredPermission: 1,
    });

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});

function requestContext() {
  const req = { user: { id: 'user_maya' } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res, next: jest.fn() };
}
