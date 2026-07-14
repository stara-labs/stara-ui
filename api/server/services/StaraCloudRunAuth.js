const { GoogleAuth } = require('google-auth-library');

const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const clients = new Map();
let auth;

const normalizeCloudRunAudience = (value) => {
  const url = new URL(String(value ?? '').trim());
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(
      'The Stara API Cloud Run audience must be an HTTPS origin without credentials, path, query, or fragment.',
    );
  }
  return url.origin;
};

const validateStaraApiAudience = (apiBaseUrl, rawAudience) => {
  const configured = String(rawAudience ?? '').trim();
  if (!configured) {
    return undefined;
  }
  const audience = normalizeCloudRunAudience(configured);
  if (new URL(apiBaseUrl).origin !== audience) {
    throw new Error('STARA_API_AUDIENCE must match the configured Stara API service origin.');
  }
  return audience;
};

const configuredAudience = (apiBaseUrl) =>
  validateStaraApiAudience(apiBaseUrl, process.env.STARA_API_AUDIENCE);

const readAuthorization = (headers) => {
  if (typeof headers?.get === 'function') {
    return headers.get('authorization');
  }
  return headers?.Authorization ?? headers?.authorization;
};

const cloudRunIdentityHeaders = async (apiBaseUrl) => {
  const audience = configuredAudience(apiBaseUrl);
  if (!audience) {
    return {};
  }
  let client = clients.get(audience);
  if (!client) {
    auth ??= new GoogleAuth();
    client = auth.getIdTokenClient(audience);
    clients.set(audience, client);
  }
  const headers = await (await client).getRequestHeaders();
  const token = readAuthorization(headers)?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token || !jwtPattern.test(token)) {
    throw new Error('Cloud Run identity returned an invalid Stara API audience token.');
  }
  return { Authorization: `Bearer ${token}` };
};

module.exports = {
  cloudRunIdentityHeaders,
  normalizeCloudRunAudience,
  validateStaraApiAudience,
};
