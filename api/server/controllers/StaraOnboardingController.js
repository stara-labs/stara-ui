const { logger } = require('@librechat/data-schemas');
const { callStaraApi, requireStaraUser, safeString } = require('~/server/services/StaraApiClient');

const STARA_ONBOARDING_VERSION = 1;
const MAX_RESPONSE_STRING_LENGTH = 512;
const ALLOWED_ACCOUNT_MODES = new Set([
  'personal',
  'business_setup',
  'business_join',
  'business_join_pending',
]);
const ALLOWED_STARTS = new Set(['chat', 'memory', 'routes', 'approvals', 'settings']);

const sanitizeResponses = (responses) => {
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) {
    return {};
  }
  return Object.entries(responses)
    .slice(0, 50)
    .reduce((result, [key, value]) => {
      const safeKey = safeString(key, undefined, 100);
      if (!safeKey) {
        return result;
      }
      if (typeof value === 'string') {
        result[safeKey] = safeString(value, '', MAX_RESPONSE_STRING_LENGTH);
      } else if (
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      ) {
        result[safeKey] = value;
      } else if (Array.isArray(value)) {
        result[safeKey] = value
          .filter((item) => typeof item === 'string')
          .slice(0, 20)
          .map((item) => safeString(item, '', MAX_RESPONSE_STRING_LENGTH));
      }
      return result;
    }, {});
};

const mapOnboardingRecord = (record) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }
  return {
    completedAt: record.completed_at ?? record.completedAt ?? null,
    mode: record.mode,
    recommendedStart: record.recommended_start ?? record.recommendedStart,
    readinessScore: record.readiness_score ?? record.readinessScore,
    responses: record.responses ?? {},
    version: record.version ?? STARA_ONBOARDING_VERSION,
  };
};

const mapOnboardingState = (profile) => {
  const source =
    profile?.stara_onboarding && typeof profile.stara_onboarding === 'object'
      ? profile.stara_onboarding
      : {};
  const sourceAddenda = source.tenant_addenda ?? source.tenantAddenda ?? {};
  const tenantAddenda = Object.entries(sourceAddenda).reduce((result, [tenantId, record]) => {
    const mapped = mapOnboardingRecord(record);
    if (mapped) {
      result[tenantId] = mapped;
    }
    return result;
  }, {});
  return {
    version: STARA_ONBOARDING_VERSION,
    account: mapOnboardingRecord(source.account),
    tenantAddenda,
    updatedAt: source.updated_at ?? source.updatedAt ?? null,
  };
};

const roleMapFrom = (accessOptions) =>
  new Map(
    (accessOptions.role_bundles ?? []).map((role) => [
      role.key,
      { label: safeString(role.label, role.key), canManage: Boolean(role.can_manage_org) },
    ]),
  );

const mapMembership = ({ entry, roleMap, activeTenantId, teams }) => {
  const tenantId = entry.org.tenant_id;
  const userId = entry.membership.user_id;
  const roleKey = entry.membership.role_key;
  return {
    id: `${tenantId}:${userId}`,
    tenantId,
    orgName: safeString(entry.org.name, tenantId),
    roleKey,
    roleLabel: roleMap.get(roleKey)?.label ?? roleKey,
    status: entry.membership.status === 'active' ? 'active' : 'disabled',
    isDefault: tenantId === activeTenantId,
    source: 'stara',
    scopeIds: Array.isArray(entry.membership.scope_ids) ? entry.membership.scope_ids : [],
    groupIds:
      tenantId === activeTenantId
        ? teams.filter((team) => team.memberIds.includes(userId)).map((team) => team.id)
        : [],
    createdAt: entry.membership.joined_at ?? null,
    updatedAt: entry.membership.updated_at ?? null,
  };
};

const mapTeam = (team) => ({
  id: team.team_id,
  name: safeString(team.name, 'Team'),
  source: 'stara',
  idOnTheSource: team.team_id,
  description: safeString(team.description),
  memberIds: Array.isArray(team.member_ids) ? team.member_ids : [],
});

const buildContext = async (inputUser) => {
  const user = requireStaraUser(inputUser);
  const account = await callStaraApi(user, '/v1/identity/sync', {
    method: 'POST',
    body: { display_name: safeString(user.name ?? user.username ?? user.email, 'Stara user') },
  });
  const onboarding = mapOnboardingState(account.user?.profile);

  let activeTenantId = null;
  let memberships = [];
  let groups = [];
  if (account.assurance?.regulated_surfaces_ready) {
    const accessOptions = await callStaraApi(user, '/v1/orgs/access-options');
    const roleMap = roleMapFrom(accessOptions);
    const orgResponse = await callStaraApi(user, '/v1/orgs');
    const entries = (orgResponse.orgs ?? []).filter(
      (entry) => entry?.org?.tenant_id && entry?.membership?.user_id,
    );
    activeTenantId = safeString(orgResponse.active_tenant_id, null);
    const activeEntry =
      entries.find(
        (entry) => entry.org.tenant_id === activeTenantId && entry.membership.status === 'active',
      ) ?? null;
    let teams = [];
    if (activeEntry) {
      const teamResponse = await callStaraApi(
        user,
        `/v1/orgs/${encodeURIComponent(activeTenantId)}/teams`,
        { tenantId: activeTenantId },
      );
      teams = (teamResponse.teams ?? []).map(mapTeam);
      groups = teams
        .filter((team) => team.memberIds.includes(account.user.id))
        .map(({ memberIds: _memberIds, ...team }) => team);
    } else {
      activeTenantId = null;
    }
    memberships = entries.map((entry) => mapMembership({ entry, roleMap, activeTenantId, teams }));
  }

  const activeMembership =
    memberships.find((membership) => membership.tenantId === activeTenantId) ?? null;
  const accountCompleted = Boolean(onboarding.account?.completedAt);
  const requiresTenantAddendum = Boolean(
    accountCompleted && activeTenantId && !onboarding.tenantAddenda[activeTenantId]?.completedAt,
  );

  return {
    version: STARA_ONBOARDING_VERSION,
    account: { completed: accountCompleted, onboarding: onboarding.account },
    onboarding,
    memberships,
    activeMembership,
    pendingInvites: [],
    access: {
      tenantId: activeTenantId,
      scopes: activeMembership?.scopeIds ?? [],
      groups,
      grants: [],
      restrictedAreas:
        activeMembership && (activeMembership.scopeIds.length || groups.length)
          ? []
          : ['No optional organization scopes are assigned.'],
    },
    requiresOnboarding: !accountCompleted,
    requiresTenantAddendum,
  };
};

const respondWithError = (res, label, error) => {
  logger.error(`[StaraOnboarding] ${label}`, error);
  return res.status(error.status ?? 500).json({
    message: safeString(error.message, 'Something went wrong.', 300),
  });
};

const getStaraOnboardingContextController = async (req, res) => {
  try {
    return res.status(200).json(await buildContext(req.user));
  } catch (error) {
    return respondWithError(res, 'Failed to load context', error);
  }
};

const syncStaraIdentityController = async (req, res) => {
  try {
    const user = requireStaraUser(req.user);
    const inviteToken = safeString(req.body?.invite_token, undefined, 512);
    const account = await callStaraApi(user, '/v1/identity/sync', {
      method: 'POST',
      body: {
        display_name: safeString(user.name ?? user.username ?? user.email, 'Stara user'),
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      },
    });
    return res.status(200).json(account);
  } catch (error) {
    return respondWithError(res, 'Failed to synchronize identity', error);
  }
};

const saveStaraOnboardingController = async (req, res) => {
  try {
    const mode = safeString(req.body?.mode);
    if (mode !== 'tenant_addendum' && !ALLOWED_ACCOUNT_MODES.has(mode)) {
      return res.status(400).json({ message: 'Invalid onboarding mode' });
    }
    const recommendedStart = ALLOWED_STARTS.has(req.body?.recommendedStart)
      ? req.body.recommendedStart
      : 'chat';
    const user = requireStaraUser(req.user);
    await callStaraApi(user, '/v1/me/onboarding', {
      method: 'PUT',
      body: {
        mode,
        ...(mode === 'tenant_addendum' ? { tenant_id: safeString(req.body?.tenantId) } : {}),
        recommended_start: recommendedStart,
        ...(typeof req.body?.readinessScore === 'number'
          ? { readiness_score: Math.max(0, Math.min(100, Math.round(req.body.readinessScore))) }
          : {}),
        responses: sanitizeResponses(req.body?.responses),
      },
    });
    return res.status(200).json(await buildContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to save onboarding', error);
  }
};

const acceptStaraTenantInviteController = async (_req, res) =>
  res.status(410).json({
    message: 'Open the secure invitation link sent to your verified email address.',
  });

const activateStaraTenantController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    if (!tenantId) {
      return res.status(400).json({ message: 'tenantId is required' });
    }
    const user = requireStaraUser(req.user);
    await callStaraApi(user, `/v1/orgs/${encodeURIComponent(tenantId)}/activate`, {
      method: 'POST',
      tenantId,
    });
    return res.status(200).json(await buildContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to activate tenant', error);
  }
};

module.exports = {
  getStaraOnboardingContextController,
  syncStaraIdentityController,
  saveStaraOnboardingController,
  acceptStaraTenantInviteController,
  activateStaraTenantController,
};
