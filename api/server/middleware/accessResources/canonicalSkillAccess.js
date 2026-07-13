const { logger } = require('@librechat/data-schemas');
const {
  getCanonicalSkillAccess,
  requiredCanonicalSkillPermissions,
} = require('~/models/canonicalSkills');

const checkCanonicalSkillRouteAccess = async ({
  req,
  res,
  next,
  skillId,
  requiredPermission,
  invoke = false,
}) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  try {
    const access = await getCanonicalSkillAccess(req.user, skillId);
    const required = requiredCanonicalSkillPermissions(requiredPermission, invoke);
    if (!required.every((permission) => access.permissions.includes(permission))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions to access this skill',
      });
    }
    req.resourceAccess = {
      resourceType: 'skill',
      resourceId: skillId,
      customResourceId: skillId,
      permission: requiredPermission,
      userId: req.user.id,
      canonicalAccess: access,
    };
    return next();
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: 'Not Found', message: 'skill not found' });
    }
    if (error.status === 401 || error.status === 403) {
      return res.status(error.status).json({
        error: error.status === 401 ? 'Unauthorized' : 'Forbidden',
        message: 'Failed to check skill access permissions',
      });
    }
    logger.error('[canonicalSkillAccess] Failed to evaluate skill access', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to check skill access permissions',
    });
  }
};

module.exports = { checkCanonicalSkillRouteAccess };
