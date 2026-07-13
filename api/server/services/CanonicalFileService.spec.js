const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

jest.mock('node-fetch', () => jest.fn());
jest.mock('./StaraServiceClient', () => ({
  callStaraApi: jest.fn(),
  getUserId: (user) => user.id,
}));

const fetch = require('node-fetch');
const { callStaraApi } = require('./StaraServiceClient');
const {
  checksumBuffer,
  checksumFile,
  createCanonicalDownload,
  deleteCanonicalFiles,
  getCanonicalDownloadStream,
  listCanonicalFiles,
  serverUploadHeaders,
  serverUploadUrl,
  uploadCanonicalBuffer,
  uploadCanonicalFile,
} = require('./CanonicalFileService');

const FILE_ID = '00000000-0000-4000-8000-000000000101';
const user = { id: 'user-1', tenantId: 'tenant_acme' };
const canonicalFile = {
  id: FILE_ID,
  tenant_id: '00000000-0000-4000-8000-000000000102',
  owner_user_id: '00000000-0000-4000-8000-000000000103',
  filename: 'hello.txt',
  media_type: 'text/plain',
  byte_size: 5,
  sensitivity: 'internal',
  status: 'ready',
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
};

describe('CanonicalFileService', () => {
  let tempDirectory;
  let filepath;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stara-file-'));
    filepath = path.join(tempDirectory, 'hello.txt');
    fs.writeFileSync(filepath, 'hello');
    delete process.env.STARA_ENV;
    delete process.env.STARA_GCS_EMULATOR_URL;
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it('computes the exact SHA-256 and base64 CRC32C upload contract', async () => {
    await expect(checksumFile(filepath)).resolves.toEqual({
      byteSize: 5,
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      crc32c: 'mnG7TA==',
    });
    expect(checksumBuffer(Buffer.from('hello'))).toEqual({
      byteSize: 5,
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      crc32c: 'mnG7TA==',
    });
  });

  it('rewrites browser emulator URLs only for a local server-side upload', () => {
    process.env.STARA_ENV = 'local';
    process.env.STARA_GCS_EMULATOR_URL = 'http://gcs:4443';
    expect(
      serverUploadUrl(
        'http://localhost:14443/stara-files/tenant/file?X-Goog-Algorithm=GOOG4-RSA-SHA256',
      ),
    ).toBe('http://gcs:4443/stara-files/tenant/file?X-Goog-Algorithm=GOOG4-RSA-SHA256');
    expect(
      serverUploadHeaders('http://localhost:14443/object', { 'content-type': 'text/plain' }),
    ).toEqual({
      'content-type': 'text/plain',
      host: 'localhost:14443',
    });

    process.env.STARA_ENV = 'production';
    expect(() => serverUploadUrl('https://storage.googleapis.com/signed')).toThrow(
      'restricted to local',
    );
  });

  it('uploads through the signed object contract and returns the existing file DTO', async () => {
    callStaraApi
      .mockResolvedValueOnce({
        file: { ...canonicalFile, status: 'pending' },
        upload: {
          url: 'https://storage.example/upload',
          method: 'PUT',
          headers: { 'content-type': 'text/plain', 'x-goog-hash': 'crc32c=mnG7TA==' },
        },
      })
      .mockResolvedValueOnce({ file: canonicalFile });
    let uploadedBody = '';
    fetch.mockImplementationOnce(async (_url, options) => {
      for await (const chunk of options.body) {
        uploadedBody += chunk.toString();
      }
      return { ok: true, status: 200 };
    });

    const result = await uploadCanonicalFile({
      user,
      file: { path: filepath, originalname: 'hello.txt', mimetype: 'text/plain' },
      fileId: FILE_ID,
      tempFileId: 'temp-1',
      metadata: { message_file: 'true' },
    });

    expect(callStaraApi.mock.calls[0]).toEqual([
      user,
      '/v1/files/uploads',
      expect.objectContaining({
        method: 'POST',
        tenantId: 'tenant_acme',
        body: expect.objectContaining({
          file_id: FILE_ID,
          byte_size: 5,
          content_crc32c: 'mnG7TA==',
        }),
      }),
    ]);
    expect(uploadedBody).toBe('hello');
    expect(result).toMatchObject({
      user: 'user-1',
      file_id: FILE_ID,
      temp_file_id: 'temp-1',
      filepath: `/api/files/download/user-1/${FILE_ID}`,
      source: 'stara',
      status: 'ready',
    });
  });

  it('soft-deletes the pending canonical record when object upload fails', async () => {
    callStaraApi
      .mockResolvedValueOnce({
        file: { ...canonicalFile, status: 'pending' },
        upload: { url: 'https://storage.example/upload', method: 'PUT', headers: {} },
      })
      .mockResolvedValueOnce({ file: { ...canonicalFile, status: 'deleted' } });
    fetch.mockImplementationOnce(async (_url, options) => {
      for await (const _chunk of options.body) {
        // Consume the staged stream before returning the simulated storage failure.
      }
      return { ok: false, status: 503 };
    });

    await expect(
      uploadCanonicalFile({
        user,
        file: { path: filepath, originalname: 'hello.txt', mimetype: 'text/plain' },
        fileId: FILE_ID,
        tempFileId: 'temp-1',
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(callStaraApi).toHaveBeenLastCalledWith(
      user,
      `/v1/files/${FILE_ID}`,
      expect.objectContaining({ method: 'DELETE', tenantId: 'tenant_acme' }),
    );
  });

  it('uploads an in-memory skill file through the canonical object contract', async () => {
    callStaraApi
      .mockResolvedValueOnce({
        file: { ...canonicalFile, status: 'pending' },
        upload: {
          url: 'https://storage.example/upload',
          method: 'PUT',
          headers: { 'content-type': 'text/plain', 'x-goog-hash': 'crc32c=mnG7TA==' },
        },
      })
      .mockResolvedValueOnce({ file: canonicalFile });
    fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(
      uploadCanonicalBuffer({
        user,
        buffer: Buffer.from('hello'),
        fileId: FILE_ID,
        filename: 'references/hello.txt',
        mediaType: 'text/plain',
      }),
    ).resolves.toMatchObject({ file_id: FILE_ID, source: 'stara', context: 'skill_file' });
    expect(fetch).toHaveBeenCalledWith(
      'https://storage.example/upload',
      expect.objectContaining({ method: 'PUT', body: Buffer.from('hello') }),
    );
  });

  it('returns a readable stream from a canonical signed download', async () => {
    callStaraApi.mockResolvedValueOnce({
      file: canonicalFile,
      download: { url: 'https://storage.example/read', method: 'GET', headers: {} },
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: Readable.from([Buffer.from('hello')]),
    });

    const stream = await getCanonicalDownloadStream(user, FILE_ID);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello');
  });

  it('maps list and download responses and deletes unique UUIDs only', async () => {
    callStaraApi
      .mockResolvedValueOnce({ files: [canonicalFile] })
      .mockResolvedValueOnce({
        file: canonicalFile,
        download: { url: 'https://storage.example/read' },
      })
      .mockResolvedValue({});

    await expect(listCanonicalFiles(user)).resolves.toEqual([
      expect.objectContaining({ file_id: FILE_ID, source: 'stara' }),
    ]);
    await expect(createCanonicalDownload(user, FILE_ID)).resolves.toMatchObject({
      file: { file_id: FILE_ID },
      download: { url: 'https://storage.example/read' },
    });
    await expect(deleteCanonicalFiles(user, [FILE_ID, FILE_ID, 'not-a-uuid'])).resolves.toEqual([
      FILE_ID,
    ]);
    expect(callStaraApi).toHaveBeenLastCalledWith(
      user,
      `/v1/files/${FILE_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
