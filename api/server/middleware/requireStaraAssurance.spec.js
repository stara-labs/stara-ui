const mockLogger = { warn: jest.fn() };
const mockGetUserById = jest.fn();

jest.mock('@librechat/data-schemas', () => ({ logger: mockLogger }));
jest.mock('~/models', () => ({ getUserById: mockGetUserById }));

const requireStaraAssurance = require('./requireStaraAssurance');

describe('requireStaraAssurance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('continues when the refreshed user has verified email and MFA enabled', async () => {
    mockGetUserById.mockResolvedValue({
      _id: 'user_1',
      emailVerified: true,
      twoFactorEnabled: true,
    });
    const req = { user: { id: 'user_1', emailVerified: false, twoFactorEnabled: false } };
    const res = response();
    const next = jest.fn();

    await requireStaraAssurance(req, res, next);

    expect(mockGetUserById).toHaveBeenCalledWith(
      'user_1',
      '_id id email emailVerified twoFactorEnabled',
    );
    expect(req.user.emailVerified).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns a fail-closed assurance error when MFA is missing', async () => {
    mockGetUserById.mockResolvedValue({
      _id: 'user_1',
      emailVerified: true,
      twoFactorEnabled: false,
    });
    const req = { user: { id: 'user_1' } };
    const res = response();
    const next = jest.fn();

    await requireStaraAssurance(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'stara_assurance_required',
        assurance: { emailVerified: true, mfaEnrolled: false },
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to request user fields when the refresh fails', async () => {
    mockGetUserById.mockRejectedValue(new Error('db unavailable'));
    const req = { user: { id: 'user_1', emailVerified: true, twoFactorEnabled: true } };
    const res = response();
    const next = jest.fn();

    await requireStaraAssurance(req, res, next);

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}
