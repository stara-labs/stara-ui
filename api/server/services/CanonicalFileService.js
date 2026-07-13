const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { Crc32c } = require('@aws-crypto/crc32c');
const { sanitizeFilename } = require('@librechat/api');
const { FileContext } = require('librechat-data-provider');
const fetch = require('node-fetch');
const { callStaraApi, getUserId } = require('./StaraServiceClient');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const SENSITIVITIES = new Set(['public', 'internal', 'confidential', 'pii', 'phi', 'financial']);

const canonicalFilesEnabled = () => {
  const explicit = process.env.STARA_CANONICAL_FILES;
  const value = explicit == null ? process.env.STARA_CANONICAL_WORKSPACE : explicit;
  return TRUE_VALUES.has(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
};

const listCanonicalFiles = async (user) => {
  const response = await callStaraApi(user, '/v1/files', { tenantId: requireTenantId(user) });
  return (response.files ?? []).map((file) => mapCanonicalFile(file, user));
};

const uploadCanonicalFile = async ({ user, file, fileId, tempFileId, metadata = {} }) => {
  if (!file?.path) {
    throw badRequest('No file was staged for upload');
  }
  const checksums = await checksumFile(file.path);
  const filename = sanitizeFilename(path.basename(file.originalname || file.filename || 'file'));
  const mediaType = file.mimetype || 'application/octet-stream';
  return uploadCanonicalContent({
    user,
    body: fs.createReadStream(file.path),
    fileId,
    filename,
    mediaType,
    checksums,
    metadata,
    mapOptions: {
      tempFileId,
      context: metadata.message_file ? FileContext.message_attachment : FileContext.agents,
      width: finiteNumber(metadata.width),
      height: finiteNumber(metadata.height),
    },
  });
};

const uploadCanonicalBuffer = async ({
  user,
  buffer,
  fileId,
  filename,
  mediaType = 'application/octet-stream',
  metadata = {},
}) => {
  if (!Buffer.isBuffer(buffer)) {
    throw badRequest('A file buffer is required');
  }
  return uploadCanonicalContent({
    user,
    body: buffer,
    fileId,
    filename: sanitizeFilename(path.basename(filename || 'file')),
    mediaType,
    checksums: checksumBuffer(buffer),
    metadata,
    mapOptions: { context: metadata.context ?? FileContext.skill_file },
  });
};

const uploadCanonicalContent = async ({
  user,
  body,
  fileId,
  filename,
  mediaType,
  checksums,
  metadata,
  mapOptions,
}) => {
  const tenantId = requireTenantId(user);
  const sensitivity = SENSITIVITIES.has(metadata.sensitivity) ? metadata.sensitivity : 'internal';
  let prepared;

  try {
    prepared = await callStaraApi(user, '/v1/files/uploads', {
      method: 'POST',
      tenantId,
      body: {
        file_id: fileId,
        filename,
        media_type: mediaType,
        byte_size: checksums.byteSize,
        content_sha256: checksums.sha256,
        content_crc32c: checksums.crc32c,
        sensitivity,
      },
    });

    const upload = prepared.upload;
    if (!upload?.url || upload.method !== 'PUT' || !upload.headers) {
      throw upstreamError('Stara API returned an invalid upload contract');
    }
    const uploaded = await fetch(serverUploadUrl(upload.url), {
      method: 'PUT',
      headers: serverUploadHeaders(upload.url, {
        ...upload.headers,
        'content-length': String(checksums.byteSize),
      }),
      body,
    });
    if (!uploaded.ok) {
      throw upstreamError(`Object upload failed with HTTP ${uploaded.status}`);
    }

    const completed = await callStaraApi(user, `/v1/files/${encodeURIComponent(fileId)}/complete`, {
      method: 'POST',
      tenantId,
    });
    return mapCanonicalFile(completed.file, user, mapOptions);
  } catch (error) {
    if (prepared?.file?.id) {
      await callStaraApi(user, `/v1/files/${encodeURIComponent(prepared.file.id)}`, {
        method: 'DELETE',
        tenantId,
      }).catch(() => undefined);
    }
    throw error;
  }
};

const createCanonicalDownload = async (user, fileId) => {
  const response = await callStaraApi(user, `/v1/files/${encodeURIComponent(fileId)}/download`, {
    tenantId: requireTenantId(user),
  });
  return { file: mapCanonicalFile(response.file, user), download: response.download };
};

const getCanonicalDownloadStream = async (user, fileId) => {
  const { download } = await createCanonicalDownload(user, fileId);
  if (!download?.url || download.method !== 'GET') {
    throw upstreamError('Stara API returned an invalid download contract');
  }
  const response = await fetch(serverUploadUrl(download.url), {
    method: 'GET',
    headers: serverUploadHeaders(download.url, download.headers ?? {}),
  });
  if (!response.ok || !response.body) {
    throw upstreamError(`Object download failed with HTTP ${response.status}`);
  }
  return response.body;
};

const deleteCanonicalFiles = async (user, fileIds) => {
  const tenantId = requireTenantId(user);
  const ids = [...new Set((fileIds ?? []).filter(isUuid))];
  await Promise.all(
    ids.map((fileId) =>
      callStaraApi(user, `/v1/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        tenantId,
      }),
    ),
  );
  return ids;
};

const mapCanonicalFile = (file, user, options = {}) => ({
  user: getUserId(user),
  tenantId: file.tenant_id,
  file_id: file.id,
  ...(options.tempFileId ? { temp_file_id: options.tempFileId } : {}),
  bytes: file.byte_size,
  embedded: false,
  filename: file.filename,
  filepath: `/api/files/download/${encodeURIComponent(getUserId(user))}/${encodeURIComponent(file.id)}`,
  object: 'file',
  type: file.media_type || 'application/octet-stream',
  usage: 0,
  context: options.context,
  source: 'stara',
  width: options.width,
  height: options.height,
  status: canonicalPreviewStatus(file.status),
  createdAt: file.created_at,
  updatedAt: file.updated_at,
  metadata: { canonical: true, sensitivity: file.sensitivity },
});

const checksumFile = async (filepath) => {
  const sha256 = createHash('sha256');
  const crc32c = new Crc32c();
  let byteSize = 0;
  for await (const chunk of fs.createReadStream(filepath)) {
    sha256.update(chunk);
    crc32c.update(chunk);
    byteSize += chunk.length;
  }
  const crcBuffer = Buffer.allocUnsafe(4);
  crcBuffer.writeUInt32BE(crc32c.digest());
  return { byteSize, sha256: sha256.digest('hex'), crc32c: crcBuffer.toString('base64') };
};

const checksumBuffer = (buffer) => {
  const crc32c = new Crc32c();
  crc32c.update(buffer);
  const crcBuffer = Buffer.allocUnsafe(4);
  crcBuffer.writeUInt32BE(crc32c.digest());
  return {
    byteSize: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    crc32c: crcBuffer.toString('base64'),
  };
};

const serverUploadUrl = (signedUrl) => {
  const emulatorUrl = process.env.STARA_GCS_EMULATOR_URL?.trim();
  if (!emulatorUrl) {
    return signedUrl;
  }
  if (String(process.env.STARA_ENV ?? '').toLowerCase() !== 'local') {
    throw new Error('STARA_GCS_EMULATOR_URL is restricted to local environments');
  }
  const target = new URL(signedUrl);
  const emulator = new URL(emulatorUrl);
  target.protocol = emulator.protocol;
  target.host = emulator.host;
  return target.toString();
};

const serverUploadHeaders = (signedUrl, headers) => {
  if (!process.env.STARA_GCS_EMULATOR_URL?.trim()) {
    return headers;
  }
  return { ...headers, host: new URL(signedUrl).host };
};

const requireTenantId = (user) => {
  const tenantId = user?.tenantId;
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    const error = new Error('An active Stara organization is required');
    error.status = 403;
    error.code = 'tenant_required';
    throw error;
  }
  return tenantId;
};

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const canonicalPreviewStatus = (status) => {
  if (status === 'ready' || status === 'pending') {
    return status;
  }
  return 'failed';
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const upstreamError = (message) => Object.assign(new Error(message), { status: 502 });

module.exports = {
  canonicalFilesEnabled,
  checksumBuffer,
  checksumFile,
  createCanonicalDownload,
  deleteCanonicalFiles,
  getCanonicalDownloadStream,
  listCanonicalFiles,
  mapCanonicalFile,
  serverUploadHeaders,
  serverUploadUrl,
  uploadCanonicalBuffer,
  uploadCanonicalFile,
};
