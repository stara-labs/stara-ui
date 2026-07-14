const { GoogleAuth } = require('google-auth-library');

const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const clients = new Map();
let auth;

const normalizeCloudRunAudience = (value, serviceLabel = 'Stara API') => {
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
      `The ${serviceLabel} Cloud Run audience must be an HTTPS origin without credentials, path, query, or fragment.`,
    );
  }
  return url.origin;
};

const validateStaraServiceAudience = ({
  serviceUrl,
  rawAudience,
  environmentVariable,
  serviceLabel,
}) => {
  const configured = String(rawAudience ?? '').trim();
  if (!configured) {
    return undefined;
  }
  const audience = normalizeCloudRunAudience(configured, serviceLabel);
  if (new URL(serviceUrl).origin !== audience) {
    throw new Error(
      `${environmentVariable} must match the configured ${serviceLabel} service origin.`,
    );
  }
  return audience;
};

const validateStaraApiAudience = (apiBaseUrl, rawAudience) => {
  return validateStaraServiceAudience({
    serviceUrl: apiBaseUrl,
    rawAudience,
    environmentVariable: 'STARA_API_AUDIENCE',
    serviceLabel: 'Stara API',
  });
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
  validateStaraServiceAudience,
};
