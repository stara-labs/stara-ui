const originalCanonicalWorkspace = process.env.STARA_CANONICAL_WORKSPACE;
process.env.STARA_CANONICAL_WORKSPACE = 'true';

jest.mock('@librechat/api', () => ({ isEnabled: () => false }));
jest.mock('librechat-data-provider', () => ({
  Constants: { NEW_CONVO: 'new' },
  ViolationTypes: { CONVO_ACCESS: 'convo_access' },
  Time: { TEN_MINUTES: 600_000 },
}));
jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => null),
  logViolation: jest.fn(),
}));
jest.mock('~/server/middleware/denyRequest', () => jest.fn());
jest.mock('~/models', () => ({
  getConvo: jest.fn(),
  searchConversation: jest.fn(),
}));

const db = require('~/models');
const validateConvoAccess = require('./convoAccess');

describe('canonical conversation access validation', () => {
  afterAll(() => restoreEnv('STARA_CANONICAL_WORKSPACE', originalCanonicalWorkspace));

  beforeEach(() => jest.clearAllMocks());

  it('uses the owner-scoped canonical read and returns 404 when access is absent', async () => {
    db.getConvo.mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await validateConvoAccess(req, res, next);

    expect(db.getConvo).toHaveBeenCalledWith('user_maya', req.body.arg.conversationId);
    expect(db.searchConversation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('continues only when the canonical API returns the actor-owned conversation', async () => {
    db.getConvo.mockResolvedValue({ conversationId: 'conversation', user: 'user_maya' });
    const next = jest.fn();

    await validateConvoAccess(makeReq(), makeRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

function makeReq() {
  return {
    body: { arg: { conversationId: '11111111-1111-4111-8111-111111111111' } },
    user: { id: 'user_maya' },
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    end: jest.fn(),
    json: jest.fn(),
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
