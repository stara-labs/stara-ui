const passport = require('passport');
const { verifyIdentityPlatformToken } = require('~/server/services/IdentityPlatformService');

const bearerToken = (req) => {
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string') {
    return undefined;
  }
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1];
};

class IdentityPlatformStrategy extends passport.Strategy {
  constructor() {
    super();
    this.name = 'identityPlatformJwt';
  }

  async authenticate(req) {
    const token = bearerToken(req);
    if (!token) {
      return this.fail({ message: 'Unauthorized' }, 401);
    }

    try {
      return this.success(await verifyIdentityPlatformToken(token));
    } catch (error) {
      if (Number(error?.status) >= 500) {
        return this.error(error);
      }
      return this.fail({ message: 'Unauthorized' }, 401);
    }
  }
}

const identityPlatformLogin = () => new IdentityPlatformStrategy();

module.exports = identityPlatformLogin;
module.exports.IdentityPlatformStrategy = IdentityPlatformStrategy;
module.exports.bearerToken = bearerToken;
