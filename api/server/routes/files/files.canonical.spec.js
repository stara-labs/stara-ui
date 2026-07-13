const express = require('express');
const request = require('supertest');

const FILE_ID = '00000000-0000-4000-8000-000000000101';

jest.mock('~/server/services/CanonicalFileService', () => ({
  canonicalFilesEnabled: jest.fn(() => true),
  createCanonicalDownload: jest.fn(),
  deleteCanonicalFiles: jest.fn(),
  listCanonicalFiles: jest.fn(),
  uploadCanonicalFile: jest.fn(),
}));
jest.mock('~/server/services/Files/process', () => ({
  filterFile: jest.fn(),
  processDeleteRequest: jest.fn(),
  processFileUpload: jest.fn(),
  processAgentFileUpload: jest.fn(),
}));
jest.mock('~/server/middleware/accessResources/fileAccess', () => ({
  fileAccess: jest.fn((_req, _res, next) => next(new Error('legacy file access called'))),
}));
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({})),
}));
jest.mock('~/server/controllers/assistants/helpers', () => ({ getOpenAIClient: jest.fn() }));
jest.mock('~/server/middleware/roles/capabilities', () => ({ hasCapability: jest.fn(() => true) }));
jest.mock('~/server/services/PermissionService', () => ({ checkPermission: jest.fn(() => true) }));
jest.mock('~/server/utils/files', () => ({
  cleanFileName: (value) => value,
  getContentDisposition: jest.fn(),
}));
jest.mock('~/cache', () => ({ getLogStores: jest.fn() }));
jest.mock('~/models', () => ({
  addAgentResourceFile: jest.fn(),
  getAgent: jest.fn(),
  removeAgentResourceFiles: jest.fn(),
}));

const {
  createCanonicalDownload,
  deleteCanonicalFiles,
  listCanonicalFiles,
  uploadCanonicalFile,
} = require('~/server/services/CanonicalFileService');
const db = require('~/models');
const router = require('./files');

describe('canonical file routes', () => {
  const user = { id: 'user-1', tenantId: 'tenant_acme', role: 'USER' };
  const file = {
    file_id: FILE_ID,
    user: 'user-1',
    filename: 'hello.txt',
    filepath: `/api/files/download/user-1/${FILE_ID}`,
    bytes: 5,
    type: 'text/plain',
    source: 'stara',
    object: 'file',
    usage: 0,
    embedded: false,
  };
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    listCanonicalFiles.mockResolvedValue([file]);
    createCanonicalDownload.mockResolvedValue({
      file,
      download: { url: 'https://storage.example/read' },
    });
    deleteCanonicalFiles.mockResolvedValue([FILE_ID]);
    uploadCanonicalFile.mockResolvedValue({ ...file, temp_file_id: 'temp-1' });

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = user;
      req.config = {};
      req.file_id = FILE_ID;
      req.file = { path: 'staged.txt', originalname: 'hello.txt', mimetype: 'text/plain' };
      next();
    });
    app.use('/files', router);
  });

  it('lists canonical files without invoking Mongo file access', async () => {
    const response = await request(app).get('/files');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([file]);
    expect(listCanonicalFiles).toHaveBeenCalledWith(user);
  });

  it('issues canonical signed downloads without legacy file middleware', async () => {
    const response = await request(app).get(`/files/download/user-1/${FILE_ID}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://storage.example/read');
    expect(createCanonicalDownload).toHaveBeenCalledWith(user, FILE_ID);
  });

  it('deletes canonical records from the existing batch endpoint', async () => {
    const response = await request(app)
      .delete('/files')
      .send({ files: [{ file_id: FILE_ID, filepath: file.filepath, source: 'stara' }] });
    expect(response.status).toBe(200);
    expect(deleteCanonicalFiles).toHaveBeenCalledWith(user, [FILE_ID]);
  });

  it('uploads a message attachment without creating a Mongo file record', async () => {
    const response = await request(app).post('/files').send({
      endpoint: 'Stara Gateway',
      file_id: 'temp-1',
      message_file: 'true',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ file_id: FILE_ID, temp_file_id: 'temp-1' });
    expect(uploadCanonicalFile).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        fileId: FILE_ID,
        tempFileId: 'temp-1',
      }),
    );
    expect(db.addAgentResourceFile).not.toHaveBeenCalled();
  });
});
