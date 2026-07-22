const { logger } = require('@librechat/data-schemas');

const { callStaraApi, requireStaraUser, safeString } = require('~/server/services/StaraApiClient');

const MANAGER_ROLES = new Set(['owner', 'admin']);
const TASK_ROLES = new Set(['owner', 'admin', 'member']);
const ENGINEERING_READ_GRANT = 'stara.engineering.read';

const requirePathId = (value, label) => {
  const id = safeString(value, undefined, 128);
  if (!id) {
    const error = new Error(`${label} is required`);
    error.status = 400;
    error.code = 'engineering_identifier_required';
    throw error;
  }
  return encodeURIComponent(id);
};

const respondWithError = (res, label, error) => {
  logger.error(`[StaraEngineering] ${label}`, error);
  return res.status(error.status ?? 500).json({
    code: safeString(error.code),
    message: safeString(error.message, 'Something went wrong.', 300),
  });
};

const activeEngineeringContext = async (inputUser) => {
  const user = requireStaraUser(inputUser);
  const [account, response] = await Promise.all([
    callStaraApi(user, '/v1/identity/sync', {
      method: 'POST',
      body: { display_name: safeString(user.name ?? user.username ?? user.email, 'Stara user') },
    }),
    callStaraApi(user, '/v1/orgs'),
  ]);
  const activeTenantId = safeString(response.active_tenant_id);
  const activeEntry = (response.orgs ?? []).find(
    (entry) =>
      entry?.org?.tenant_id === activeTenantId &&
      entry?.org?.status === 'active' &&
      entry?.membership?.status === 'active',
  );

  if (!activeTenantId || !activeEntry) {
    return { user, activeTenantId: null, activeEntry: null, platformEngineeringAccess: false };
  }
  const activeMembership = (account.memberships ?? []).find(
    (membership) =>
      membership?.tenant_key === activeTenantId &&
      membership?.tenant_status === 'active' &&
      membership?.membership_status === 'active',
  );
  const platformEngineeringAccess =
    Array.isArray(activeMembership?.mcp_grants) &&
    activeMembership.mcp_grants.includes(ENGINEERING_READ_GRANT);
  return { user, activeTenantId, activeEntry, platformEngineeringAccess };
};

const requireActiveEngineeringContext = async (inputUser) => {
  const context = await activeEngineeringContext(inputUser);
  if (!context.activeTenantId || !context.activeEntry) {
    const error = new Error('An active organization is required for engineering work');
    error.status = 409;
    error.code = 'engineering_active_org_required';
    throw error;
  }
  if (!context.platformEngineeringAccess) {
    const error = new Error('Platform engineering is not available to this organization');
    error.status = 403;
    error.code = 'platform_engineering_access_denied';
    throw error;
  }
  return context;
};

const callForActiveTenant = (context, path, options = {}) =>
  callStaraApi(context.user, path, {
    ...options,
    tenantId: context.activeTenantId,
  });

const loadBusinessProfile = async (context) => {
  try {
    return await callForActiveTenant(
      context,
      `/v1/orgs/${encodeURIComponent(context.activeTenantId)}/business-profile`,
    );
  } catch (error) {
    if (error.status === 404) {
      return { business_profile: null };
    }
    throw error;
  }
};

const getEngineeringContextController = async (req, res) => {
  try {
    const context = await activeEngineeringContext(req.user);
    if (!context.activeTenantId || !context.activeEntry) {
      return res.status(200).json({
        platform_engineering_access: false,
        active_tenant_id: null,
        active_org_name: null,
        actor_role_key: null,
        permissions: {
          can_connect_repository: false,
          can_create_task: false,
          can_decide_approval: false,
          can_update_policy: false,
          can_update_business_profile: false,
        },
        repositories: [],
        tasks: [],
        approvals: [],
        business_profile: null,
        policy_config: null,
        readiness: null,
      });
    }

    if (!context.platformEngineeringAccess) {
      return res.status(200).json({
        platform_engineering_access: false,
        active_tenant_id: context.activeTenantId,
        active_org_name: safeString(context.activeEntry.org?.name, context.activeTenantId),
        actor_role_key: safeString(context.activeEntry.membership?.role_key),
        permissions: {
          can_connect_repository: false,
          can_create_task: false,
          can_decide_approval: false,
          can_update_policy: false,
          can_update_business_profile: false,
        },
        repositories: [],
        tasks: [],
        approvals: [],
        business_profile: null,
        policy_config: null,
        readiness: null,
      });
    }

    const [
      repositoryResponse,
      taskResponse,
      approvalResponse,
      profileResponse,
      policyResponse,
      readinessResponse,
    ] = await Promise.all([
      callForActiveTenant(context, '/v1/engineering/repositories'),
      callForActiveTenant(context, '/v1/engineering/tasks'),
      callForActiveTenant(context, '/v1/engineering/approvals'),
      loadBusinessProfile(context),
      callForActiveTenant(
        context,
        `/v1/orgs/${encodeURIComponent(context.activeTenantId)}/policy-config`,
      ),
      callForActiveTenant(
        context,
        `/v1/orgs/${encodeURIComponent(context.activeTenantId)}/readiness`,
      ),
    ]);
    const roleKey = safeString(context.activeEntry.membership?.role_key);

    return res.status(200).json({
      platform_engineering_access: true,
      active_tenant_id: context.activeTenantId,
      active_org_name: safeString(context.activeEntry.org?.name, context.activeTenantId),
      actor_role_key: roleKey,
      permissions: {
        can_connect_repository: MANAGER_ROLES.has(roleKey),
        can_create_task: TASK_ROLES.has(roleKey),
        can_decide_approval: MANAGER_ROLES.has(roleKey),
        can_update_policy: MANAGER_ROLES.has(roleKey),
        can_update_business_profile: MANAGER_ROLES.has(roleKey),
      },
      repositories: repositoryResponse.repositories ?? [],
      tasks: taskResponse.tasks ?? [],
      approvals: approvalResponse.approvals ?? [],
      business_profile: profileResponse.business_profile ?? null,
      policy_config: policyResponse.policy_config ?? null,
      readiness: readinessResponse.readiness ?? null,
    });
  } catch (error) {
    return respondWithError(res, 'Failed to load engineering context', error);
  }
};

const createRepositoryConnectionController = async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const result = await callForActiveTenant(context, '/v1/engineering/repositories', {
      method: 'POST',
      body: req.body,
    });
    return res.status(201).json(result);
  } catch (error) {
    return respondWithError(res, 'Failed to connect repository', error);
  }
};

const updateRepositoryConnectionController = async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const repositoryId = requirePathId(req.params.repositoryId, 'Repository connection ID');
    const result = await callForActiveTenant(
      context,
      `/v1/engineering/repositories/${repositoryId}`,
      { method: 'PATCH', body: req.body },
    );
    return res.status(200).json(result);
  } catch (error) {
    return respondWithError(res, 'Failed to update repository configuration', error);
  }
};

const updateEngineeringPolicyController = async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const result = await callForActiveTenant(
      context,
      `/v1/orgs/${encodeURIComponent(context.activeTenantId)}/policy-config`,
      { method: 'PUT', body: req.body },
    );
    return res.status(200).json(result.policy_config ?? null);
  } catch (error) {
    return respondWithError(res, 'Failed to update engineering policy', error);
  }
};

const updateBusinessProfileController = async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const result = await callForActiveTenant(
      context,
      `/v1/orgs/${encodeURIComponent(context.activeTenantId)}/business-profile`,
      { method: 'PUT', body: req.body },
    );
    return res.status(200).json(result.business_profile ?? null);
  } catch (error) {
    return respondWithError(res, 'Failed to update business profile', error);
  }
};

const createEngineeringTaskController = async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const result = await callForActiveTenant(context, '/v1/engineering/tasks', {
      method: 'POST',
      body: req.body,
    });
    return res.status(201).json(result);
  } catch (error) {
    return respondWithError(res, 'Failed to create engineering task', error);
  }
};

const startEngineeringRunController = async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const taskId = requirePathId(req.params.taskId, 'Engineering task ID');
    const result = await callForActiveTenant(context, `/v1/engineering/tasks/${taskId}/runs`, {
      method: 'POST',
      body: req.body,
    });
    return res.status(201).json(result);
  } catch (error) {
    return respondWithError(res, 'Failed to start engineering run', error);
  }
};

const getEngineeringRunController = async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const runId = requirePathId(req.params.runId, 'Engineering run ID');
    return res
      .status(200)
      .json(await callForActiveTenant(context, `/v1/engineering/runs/${runId}`));
  } catch (error) {
    return respondWithError(res, 'Failed to load engineering run', error);
  }
};

const forwardRunMutation = (suffix, successStatus, label) => async (req, res) => {
  try {
    const context = await requireActiveEngineeringContext(req.user);
    const runId = requirePathId(req.params.runId, 'Engineering run ID');
    const result = await callForActiveTenant(context, `/v1/engineering/runs/${runId}/${suffix}`, {
      method: 'POST',
      body: req.body,
    });
    return res.status(successStatus).json(result);
  } catch (error) {
    return respondWithError(res, label, error);
  }
};

const decideEngineeringRunController = forwardRunMutation(
  'decisions',
  200,
  'Failed to decide engineering approval',
);
const cancelEngineeringRunController = forwardRunMutation(
  'cancel',
  200,
  'Failed to cancel engineering run',
);
const retryEngineeringRunController = forwardRunMutation(
  'retry',
  201,
  'Failed to retry engineering run',
);
const resumeEngineeringRunController = forwardRunMutation(
  'resume',
  200,
  'Failed to resume engineering run',
);

module.exports = {
  cancelEngineeringRunController,
  createEngineeringTaskController,
  createRepositoryConnectionController,
  decideEngineeringRunController,
  getEngineeringContextController,
  getEngineeringRunController,
  resumeEngineeringRunController,
  retryEngineeringRunController,
  startEngineeringRunController,
  updateBusinessProfileController,
  updateEngineeringPolicyController,
  updateRepositoryConnectionController,
};
