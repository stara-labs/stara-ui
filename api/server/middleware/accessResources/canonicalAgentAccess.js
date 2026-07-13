const { logger } = require('@librechat/data-schemas');
const {
  getCanonicalAgentAccess,
  requiredCanonicalPermissions,
} = require('~/models/canonicalAgents');

const checkCanonicalAgentRouteAccess = async ({
  req,
  res,
  next,
  agentId,
  requiredPermission,
  invoke = false,
}) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  try {
    const access = await getCanonicalAgentAccess(req.user, agentId);
    const required = requiredCanonicalPermissions(requiredPermission, invoke);
    if (!required.every((permission) => access.permissions.includes(permission))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions to access this agent',
      });
    }
    req.resourceAccess = {
      resourceType: 'agent',
      resourceId: agentId,
      customResourceId: agentId,
      permission: requiredPermission,
      userId: req.user.id,
      canonicalAccess: access,
    };
    return next();
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: 'Not Found', message: 'agent not found' });
    }
    logger.error('[canonicalAgentAccess] Failed to evaluate agent access', error);
    return res.status(error.status === 401 ? 401 : 500).json({
      error: error.status === 401 ? 'Unauthorized' : 'Internal Server Error',
      message: 'Failed to check agent access permissions',
    });
  }
};

module.exports = { checkCanonicalAgentRouteAccess };
