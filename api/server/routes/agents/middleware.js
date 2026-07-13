const { getRequestId, getTenantId, logger, tenantStorage } = require('@librechat/data-schemas');
const { PermissionTypes, Permissions, PermissionBits } = require('librechat-data-provider');
const {
  generateCheckAccess,
  preAuthTenantMiddleware,
  createRequireApiKeyAuth,
  createRemoteAgentAuth,
  createCheckRemoteAgentAccess,
} = require('@librechat/api');
const { getEffectivePermissions } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');
const {
  canonicalAgentsEnabled,
  canonicalPermissionBits,
  getCanonicalAgentAccess,
} = require('~/models/canonicalAgents');

const apiKeyMiddleware = createRequireApiKeyAuth({
  validateAgentApiKey: db.validateAgentApiKey,
  findUser: db.findUser,
});

const requireRemoteAgentAuth = createRemoteAgentAuth({
  apiKeyMiddleware,
  findUser: db.findUser,
  getRolesByNames: db.findRolesByNames,
  updateUser: db.updateUser,
  getAppConfig,
});

const checkRemoteAgentsFeature = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName: db.getRoleByName,
});

const legacyCheckAgentPermission = createCheckRemoteAgentAccess({
  getAgent: db.getAgent,
  getEffectivePermissions,
});

const canonicalAgentRequestContext = (req, _res, next) => {
  if (!canonicalAgentsEnabled()) {
    return next();
  }
  return tenantStorage.run(
    {
      tenantId: req.user?.tenantId ?? getTenantId(),
      userId: req.user?.id?.toString?.(),
      requestId: getRequestId(),
    },
    next,
  );
};

const checkAgentPermission = async (req, res, next) => {
  if (!canonicalAgentsEnabled()) {
    return legacyCheckAgentPermission(req, res, next);
  }
  const agentId = req.body?.model || req.params?.model;
  if (!agentId) {
    return res.status(400).json({
      error: {
        message: 'Model (agent ID) is required',
        type: 'invalid_request_error',
        code: 'missing_model',
      },
    });
  }
  try {
    const access = await getCanonicalAgentAccess(req.user, agentId);
    if (!access.permissions.includes('agent.invoke')) {
      return res.status(403).json({
        error: {
          message: `No remote access to agent: ${agentId}`,
          type: 'permission_error',
          code: 'access_denied',
        },
      });
    }
    const agent = await db.getAgent({ id: agentId });
    if (!agent) {
      return res.status(404).json({
        error: {
          message: `Agent not found: ${agentId}`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      });
    }
    req.agent = agent;
    req.agentPermissions = canonicalPermissionBits(access, true) | PermissionBits.VIEW;
    return next();
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({
        error: {
          message: `Agent not found: ${agentId}`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      });
    }
    logger.error('[canonicalAgentPermission] Error checking agent access', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error while checking agent access',
        type: 'server_error',
        code: 'internal_error',
      },
    });
  }
};

module.exports = {
  checkAgentPermission,
  canonicalAgentRequestContext,
  preAuthTenantMiddleware,
  requireRemoteAgentAuth,
  checkRemoteAgentsFeature,
};
