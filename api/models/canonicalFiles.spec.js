jest.mock('@librechat/data-schemas', () => ({ getUserId: jest.fn() }));
jest.mock('~/server/services/CanonicalFileService', () => ({
  canonicalFilesEnabled: jest.fn(),
  listCanonicalFiles: jest.fn(),
}));

const mockGetCanonicalRequestUser = jest.fn();
jest.mock('~/server/services/StaraApiClient', () => ({
  getCanonicalRequestUser: (...args) => mockGetCanonicalRequestUser(...args),
}));

const { getUserId } = require('@librechat/data-schemas');
const {
  canonicalFilesEnabled,
  listCanonicalFiles,
} = require('~/server/services/CanonicalFileService');
const { createCanonicalFileMethods, matchesFilter } = require('./canonicalFiles');

const canonical = {
  file_id: '00000000-0000-4000-8000-000000000101',
  user: 'user-1',
  filename: 'canonical.txt',
  source: 'stara',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

describe('canonical file model adapter', () => {
  const legacy = {
    file_id: 'legacy-file',
    user: 'user-1',
    filename: 'legacy.txt',
    source: 'local',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
  const baseMethods = {
    getUserById: jest.fn(),
    getFiles: jest.fn().mockResolvedValue([legacy]),
    findFileById: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STARA_NATIVE_RUNTIME;
    delete process.env.STARA_LEGACY_FILE_READ_FALLBACK;
    getUserId.mockReturnValue('user-1');
    canonicalFilesEnabled.mockReturnValue(true);
    listCanonicalFiles.mockResolvedValue([canonical]);
    mockGetCanonicalRequestUser.mockReturnValue({
      _id: 'user-1',
      id: 'user-1',
      tenantId: 'tenant_acme',
      email: 'maya@example.com',
    });
    baseMethods.getFiles.mockResolvedValue([legacy]);
  });

  it('does not replace legacy methods when canonical files are disabled', () => {
    canonicalFilesEnabled.mockReturnValue(false);
    expect(createCanonicalFileMethods(baseMethods)).toEqual({});
  });

  it('returns canonical files first and keeps legacy records only for migration reads', async () => {
    const methods = createCanonicalFileMethods(baseMethods);

    await expect(methods.getFiles({ user: 'user-1' })).resolves.toEqual([canonical, legacy]);
    expect(listCanonicalFiles).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
    expect(mockGetCanonicalRequestUser).toHaveBeenCalledWith('user-1');
    expect(baseMethods.getUserById).not.toHaveBeenCalled();
    await expect(methods.findFileById(canonical.file_id)).resolves.toEqual(canonical);
  });

  it('can disable the Mongo fallback after offline migration', async () => {
    process.env.STARA_LEGACY_FILE_READ_FALLBACK = 'false';
    const methods = createCanonicalFileMethods(baseMethods);

    await expect(methods.getFiles({ file_id: canonical.file_id })).resolves.toEqual([canonical]);
    expect(baseMethods.getFiles).not.toHaveBeenCalled();
  });

  it('never reads the Mongo fallback in native mode', async () => {
    process.env.STARA_NATIVE_RUNTIME = 'true';
    const methods = createCanonicalFileMethods(baseMethods);

    await expect(methods.getFiles({ file_id: canonical.file_id })).resolves.toEqual([canonical]);
    expect(baseMethods.getFiles).not.toHaveBeenCalled();
  });

  it('supports the Mongo-style filters used by attachment readers', () => {
    expect(
      matchesFilter(canonical, { file_id: { $in: [canonical.file_id] }, source: { $ne: 'local' } }),
    ).toBe(true);
    expect(matchesFilter(canonical, { $or: [{ embedded: true }, { source: 'stara' }] })).toBe(true);
    expect(matchesFilter(canonical, { 'metadata.codeEnvRef': { $exists: true } })).toBe(false);
  });
});
