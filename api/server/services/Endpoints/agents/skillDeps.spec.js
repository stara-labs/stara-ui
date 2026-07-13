const mockSaveBuffer = jest.fn();
const mockDeleteFile = jest.fn();
const mockGetStrategyFunctions = jest.fn();
const mockGetFileStrategy = jest.fn();
const mockGetStorageMetadata = jest.fn();
const mockResolveRequestTenantId = jest.fn();
const mockCreateDeploymentSkillMethods = jest.fn((methods) => methods);
const mockCanonicalSkillsEnabled = jest.fn();
const mockCanonicalFilesEnabled = jest.fn();
const mockDeleteCanonicalFiles = jest.fn();
const mockGetCanonicalDownloadStream = jest.fn();
const mockUploadCanonicalBuffer = jest.fn();

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: (...args) => mockGetStrategyFunctions(...args),
}));

jest.mock('~/server/services/Files/Code/crud', () => ({
  batchUploadCodeEnvFiles: jest.fn(),
}));

jest.mock('~/server/services/Files/Code/process', () => ({
  getSessionInfo: jest.fn(),
  checkIfActive: jest.fn(),
  readSandboxFile: jest.fn(),
  writeSandboxFile: jest.fn(),
}));

jest.mock('@librechat/api', () => ({
  checkAccess: jest.fn(),
  createDeploymentSkillMethods: (...args) => mockCreateDeploymentSkillMethods(...args),
  enrichWithSkillConfigurable: jest.fn(),
  getDeploymentSkillDownloadStream: jest.fn(),
  getStorageMetadata: (...args) => mockGetStorageMetadata(...args),
  isDeploymentSkillFileSource: jest.fn(() => false),
  mergeDeploymentSkillIds: jest.fn((ids = []) => ids),
  resolveRequestTenantId: (...args) => mockResolveRequestTenantId(...args),
}));

jest.mock('librechat-data-provider', () => ({
  AccessRoleIds: { SKILL_OWNER: 'SKILL_OWNER' },
  FileContext: { skill_file: 'skill_file' },
  PermissionBits: { EDIT: 2 },
  Permissions: { USE: 'USE', CREATE: 'CREATE' },
  PermissionTypes: { SKILLS: 'SKILLS' },
  PrincipalType: { USER: 'USER' },
  ResourceType: { SKILL: 'SKILL' },
  isEphemeralAgentId: jest.fn(() => false),
}));

jest.mock('~/server/services/PermissionService', () => ({
  checkPermission: jest.fn(),
  grantPermission: jest.fn(),
}));

jest.mock('~/models/canonicalSkills', () => ({
  canonicalSkillsEnabled: () => mockCanonicalSkillsEnabled(),
}));

jest.mock('~/server/services/CanonicalFileService', () => ({
  canonicalFilesEnabled: () => mockCanonicalFilesEnabled(),
  deleteCanonicalFiles: (...args) => mockDeleteCanonicalFiles(...args),
  getCanonicalDownloadStream: (...args) => mockGetCanonicalDownloadStream(...args),
  uploadCanonicalBuffer: (...args) => mockUploadCanonicalBuffer(...args),
}));

jest.mock('~/server/utils/getFileStrategy', () => ({
  getFileStrategy: (...args) => mockGetFileStrategy(...args),
}));

const mockDb = {
  getSkillFileByPath: jest.fn(),
  upsertSkillFile: jest.fn(),
};

jest.mock('~/models', () => mockDb);

const { getSkillStrategyFunctions, getSkillToolDeps } = require('./skillDeps');

describe('skillDeps saveSkillFileContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFileStrategy.mockReturnValue('s3');
    mockCanonicalSkillsEnabled.mockReturnValue(false);
    mockCanonicalFilesEnabled.mockReturnValue(false);
    mockDeleteCanonicalFiles.mockResolvedValue([]);
    mockUploadCanonicalBuffer.mockResolvedValue({ file_id: 'canonical-file' });
    mockGetStrategyFunctions.mockReturnValue({
      saveBuffer: mockSaveBuffer,
      deleteFile: mockDeleteFile,
    });
    mockSaveBuffer.mockResolvedValue('https://files.example.test/uploads/file.txt');
    mockDeleteFile.mockResolvedValue(undefined);
    mockGetStorageMetadata.mockReturnValue({
      storageKey: 'uploads/file.txt',
      storageRegion: 'us-east-2',
    });
    mockResolveRequestTenantId.mockReturnValue('tenant-1');
    mockDb.getSkillFileByPath.mockResolvedValue(null);
  });

  it('cleans up the uploaded object when metadata upsert returns no row', async () => {
    mockDb.upsertSkillFile.mockResolvedValue(null);

    await expect(
      getSkillToolDeps().saveSkillFileContent({
        req: {
          user: { id: 'user-1', _id: 'user-1' },
          config: {},
        },
        skillId: 'skill-1',
        relativePath: 'references/template.html',
        content: '<html></html>',
        mimeType: 'text/html',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_FILE_UPSERT_NOT_FOUND' });

    expect(mockDeleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'user-1' }) }),
      {
        filepath: 'https://files.example.test/uploads/file.txt',
        user: 'user-1',
        tenantId: 'tenant-1',
      },
    );
  });

  it('uses canonical GCS storage and cleans up a failed metadata association', async () => {
    mockCanonicalSkillsEnabled.mockReturnValue(true);
    mockCanonicalFilesEnabled.mockReturnValue(true);
    mockDb.upsertSkillFile.mockResolvedValue(null);

    await expect(
      getSkillToolDeps().saveSkillFileContent({
        req: {
          user: { id: 'user-1', _id: 'user-1', tenantId: 'tenant-1' },
          config: {},
        },
        skillId: '22222222-2222-4222-8222-222222222222',
        relativePath: 'references/template.html',
        content: '<html></html>',
        mimeType: 'text/html',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_FILE_UPSERT_NOT_FOUND' });

    const fileId = mockUploadCanonicalBuffer.mock.calls[0][0].fileId;
    expect(mockUploadCanonicalBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
        filename: 'template.html',
        mediaType: 'text/html',
      }),
    );
    expect(mockDeleteCanonicalFiles).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      [fileId],
    );
    expect(mockSaveBuffer).not.toHaveBeenCalled();
  });

  it('streams stara skill files through canonical signed downloads', async () => {
    const req = { user: { id: 'user-1', tenantId: 'tenant-1' } };
    getSkillStrategyFunctions('stara').getDownloadStream(req, 'file-1');
    expect(mockGetCanonicalDownloadStream).toHaveBeenCalledWith(req.user, 'file-1');
  });
});
