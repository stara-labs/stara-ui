const { identityPlatformAuthEnabled } = require('~/server/services/IdentityPlatformService');

const requireLegacyAuthMode = (_req, res, next) => {
  if (!identityPlatformAuthEnabled()) {
    return next();
  }

  return res.status(410).json({
    error: 'identity_platform_auth_required',
    message: 'This authentication operation is managed by Google Identity Platform.',
  });
};

module.exports = requireLegacyAuthMode;
