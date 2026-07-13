jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));

jest.mock('~/models/canonicalAgents', () => ({
  getCanonicalAgentAccess: jest.fn(),
  requiredCanonicalPermissions: (permission, invoke) => {
    const required = [];
    if ((permission & 1) !== 0) required.push(invoke ? 'agent.invoke' : 'agent.read');
    if ((permission & 2) !== 0) required.push('agent.edit');
    if ((permission & 4) !== 0) required.push('agent.delete');
    if ((permission & 8) !== 0) required.push('agent.share');
    return required;
  },
}));

const { getCanonicalAgentAccess } = require('~/models/canonicalAgents');
const { checkCanonicalAgentRouteAccess } = require('./canonicalAgentAccess');

describe('canonical agent route access', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows canonical read and records the evaluated access', async () => {
    const access = { permissions: ['agent.read'], role_keys: ['viewer'], owner: false };
    getCanonicalAgentAccess.mockResolvedValue(access);
    const { req, res, next } = requestContext();

    await checkCanonicalAgentRouteAccess({
      req,
      res,
      next,
      agentId: 'agent_11111111-1111-4111-8111-111111111111',
      requiredPermission: 1,
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.resourceAccess.canonicalAccess).toBe(access);
  });

  it('does not treat read permission as invoke permission', async () => {
    getCanonicalAgentAccess.mockResolvedValue({
      permissions: ['agent.read'],
      role_keys: ['viewer'],
      owner: false,
    });
    const { req, res, next } = requestContext();

    await checkCanonicalAgentRouteAccess({
      req,
      res,
      next,
      agentId: 'agent_11111111-1111-4111-8111-111111111111',
      requiredPermission: 1,
      invoke: true,
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps missing and inaccessible agents non-enumerable', async () => {
    const error = new Error('not found');
    error.status = 404;
    getCanonicalAgentAccess.mockRejectedValue(error);
    const { req, res, next } = requestContext();

    await checkCanonicalAgentRouteAccess({
      req,
      res,
      next,
      agentId: 'agent_missing',
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
