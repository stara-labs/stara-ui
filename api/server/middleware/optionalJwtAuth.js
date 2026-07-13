const cookies = require('cookie');
const passport = require('passport');
const { isEnabled, tenantContextMiddleware } = require('@librechat/api');
const {
  isCanonicalIdentityContextEnabled,
  resolveCanonicalRequestUser,
  runWithCanonicalRequestUser,
} = require('~/server/services/StaraApiClient');
const { identityPlatformAuthEnabled } = require('~/server/services/IdentityPlatformService');

const hasPassportStrategy = (strategy) =>
  typeof passport._strategy === 'function' && passport._strategy(strategy) != null;

// This middleware does not require authentication,
// but if the user is authenticated, it will set the user object
// and establish tenant ALS context.
const optionalJwtAuth = (req, res, next) => {
  const cookieHeader = req.headers.cookie;
  const tokenProvider = cookieHeader ? cookies.parse(cookieHeader).token_provider : null;
  const useOpenIdJwt =
    tokenProvider === 'openid' &&
    isEnabled(process.env.OPENID_REUSE_TOKENS) &&
    hasPassportStrategy('openidJwt');
  let strategy = 'jwt';
  if (identityPlatformAuthEnabled()) {
    strategy = 'identityPlatformJwt';
  } else if (useOpenIdJwt) {
    strategy = 'openidJwt';
  }
  const callback = (err, user) => {
    if (err) {
      return next(err);
    }
    if (user) {
      const continueWithUser = (resolvedUser, canonicalIdentity = false) => {
        const continueAuthentication = () => {
          req.user = resolvedUser;
          req.authStrategy = strategy;
          return tenantContextMiddleware(req, res, next);
        };
        return canonicalIdentity
          ? runWithCanonicalRequestUser(resolvedUser, continueAuthentication)
          : continueAuthentication();
      };
      if (!isCanonicalIdentityContextEnabled()) {
        return continueWithUser(user);
      }
      return resolveCanonicalRequestUser(user)
        .then((resolvedUser) => continueWithUser(resolvedUser, true))
        .catch(next);
    }
    next();
  };
  passport.authenticate(strategy, { session: false }, callback)(req, res, next);
};

module.exports = optionalJwtAuth;
