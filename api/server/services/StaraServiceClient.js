const fetch = require('node-fetch');

const safeString = (value, fallback = undefined, maxLength = 512) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
};

const normalizeEmail = (value) => safeString(value, '', 320).toLowerCase();
const getUserId = (user) => safeString(user?.id ?? user?._id?.toString());

const staraApiBaseUrl = () =>
  safeString(process.env.STARA_API_URL ?? process.env.STARA_API_BASE_URL, '', 2048).replace(
    /\/+$/,
    '',
  );

const requireStaraApiBaseUrl = () => {
  const value = staraApiBaseUrl();
  if (value) {
    return value;
  }
  const error = new Error('The Stara API is not configured');
  error.status = 503;
  throw error;
};

const identitySubject = (user) =>
  safeString(user?.identitySubject ?? user?.idOnTheSource, undefined, 512) ??
  `librechat:${getUserId(user)}`;

const staraApiHeaders = (user, tenantId) => ({
  'Content-Type': 'application/json',
  'x-stara-identity-subject': identitySubject(user),
  'x-stara-actor-email': normalizeEmail(user?.email),
  'x-stara-display-name': safeString(user?.name ?? user?.username ?? user?.email, 'Stara user'),
  'x-stara-email-verified': user?.emailVerified ? 'true' : 'false',
  'x-stara-mfa-enrolled': user?.twoFactorEnabled ? 'true' : 'false',
  ...(tenantId ? { 'x-stara-tenant-id': tenantId } : {}),
  ...(process.env.STARA_API_TOKEN
    ? { Authorization: `Bearer ${process.env.STARA_API_TOKEN}` }
    : {}),
});

const callStaraApi = async (user, path, options = {}) => {
  const response = await fetch(`${requireStaraApiBaseUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers: staraApiHeaders(user, options.tenantId),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const error = new Error(
      safeString(payload.message ?? payload.error, 'The Stara API request failed', 300),
    );
    error.status = response.status;
    error.code = safeString(payload.error);
    throw error;
  }
  return payload;
};

module.exports = {
  callStaraApi,
  getUserId,
  normalizeEmail,
  safeString,
  staraApiBaseUrl,
};
