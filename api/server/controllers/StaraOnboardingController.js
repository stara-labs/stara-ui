const mongoose = require('mongoose');
const { PrincipalType } = require('librechat-data-provider');
const { logger, runAsSystem } = require('@librechat/data-schemas');
const db = require('~/models');

const STARA_ONBOARDING_VERSION = 1;
const STARA_TENANT_INVITE = 'stara_tenant_invite';
const MAX_INVITES_TO_RETURN = 20;
const MAX_RESPONSE_STRING_LENGTH = 512;

const allowedAccountModes = new Set([
  'personal',
  'business_setup',
  'business_join',
  'business_join_pending',
]);

const getObjectIdString = (value) => {
  if (value == null) {
    return undefined;
  }
  return typeof value === 'string' ? value : value.toString();
};

const getUserId = (user) => getObjectIdString(user?.id ?? user?._id);

const getMetadataValue = (metadata, key) => {
  if (!metadata) {
    return undefined;
  }
  if (typeof metadata.get === 'function') {
    return metadata.get(key);
  }
  return metadata[key];
};

const safeString = (value, fallback = undefined) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, MAX_RESPONSE_STRING_LENGTH);
};

const sanitizeResponses = (responses) => {
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) {
    return {};
  }

  return Object.entries(responses).reduce((acc, [key, value]) => {
    const safeKey = safeString(key);
    if (!safeKey) {
      return acc;
    }
    if (typeof value === 'string') {
      acc[safeKey] = safeString(value, '');
      return acc;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      acc[safeKey] = value;
      return acc;
    }
    if (Array.isArray(value)) {
      acc[safeKey] = value
        .filter((item) => typeof item === 'string')
        .slice(0, 20)
        .map((item) => safeString(item, ''));
    }
    return acc;
  }, {});
};

const normalizeOnboardingState = (state) => {
  const source = state && typeof state === 'object' ? state : {};
  return {
    version: source.version ?? STARA_ONBOARDING_VERSION,
    account: source.account && typeof source.account === 'object' ? source.account : undefined,
    tenantAddenda:
      source.tenantAddenda && typeof source.tenantAddenda === 'object' ? source.tenantAddenda : {},
    updatedAt: source.updatedAt,
  };
};

const sanitizeOnboardingState = (state) => {
  const normalized = normalizeOnboardingState(state);
  return {
    version: STARA_ONBOARDING_VERSION,
    account: normalized.account ?? null,
    tenantAddenda: normalized.tenantAddenda ?? {},
    updatedAt: normalized.updatedAt ?? null,
  };
};

const toSafeMembership = (membership, activeTenantId) => {
  if (!membership) {
    return null;
  }
  const tenantId = safeString(membership.tenantId);
  return {
    id: getObjectIdString(membership._id) ?? `legacy:${tenantId}`,
    tenantId,
    orgName: safeString(membership.orgName, tenantId),
    roleKey: safeString(membership.roleKey, 'member'),
    roleLabel: safeString(membership.roleLabel, 'Member'),
    status: membership.status ?? 'active',
    isDefault: Boolean(membership.isDefault || tenantId === activeTenantId),
    source: membership.source ?? 'stara',
    scopeIds: Array.isArray(membership.scopeIds) ? membership.scopeIds : [],
    groupIds: Array.isArray(membership.groupIds) ? membership.groupIds : [],
    createdAt: membership.createdAt ?? null,
    updatedAt: membership.updatedAt ?? null,
  };
};

const toSyntheticLegacyMembership = (user) => {
  const tenantId = safeString(user?.tenantId);
  if (!tenantId) {
    return null;
  }
  return {
    _id: `legacy:${tenantId}`,
    userId: getUserId(user),
    tenantId,
    orgName: tenantId,
    roleKey: 'member',
    roleLabel: 'Member',
    status: 'active',
    isDefault: true,
    source: 'legacy',
    scopeIds: [],
    groupIds: [],
  };
};

const toSafeInvite = (token) => {
  const metadata = token.metadata;
  const tenantId = safeString(token.tenantId ?? getMetadataValue(metadata, 'tenantId'));
  if (!tenantId) {
    return null;
  }

  return {
    id: getObjectIdString(token._id),
    tenantId,
    orgName: safeString(getMetadataValue(metadata, 'orgName'), tenantId),
    roleLabel: safeString(getMetadataValue(metadata, 'roleLabel'), 'Member'),
    invitedByName: safeString(getMetadataValue(metadata, 'invitedByName')),
    expiresAt: token.expiresAt,
    createdAt: token.createdAt,
  };
};

const hasCompletedTenantAddendum = (onboarding, tenantId) => {
  if (!tenantId) {
    return false;
  }
  return Boolean(onboarding.tenantAddenda?.[tenantId]?.completedAt);
};

const resolveMemberships = async (user) => {
  const memberships = await db.listTenantMemberships({
    userId: getUserId(user),
    status: ['active', 'invited', 'disabled'],
  });
  const legacyMembership = toSyntheticLegacyMembership(user);
  const hasLegacyTenant =
    legacyMembership &&
    !memberships.some((membership) => membership.tenantId === legacyMembership.tenantId);
  const allMemberships = hasLegacyTenant ? [legacyMembership, ...memberships] : memberships;
  const activeTenantId =
    safeString(user.tenantId) ??
    allMemberships.find((membership) => membership.isDefault)?.tenantId ??
    allMemberships.find((membership) => membership.status === 'active')?.tenantId;

  const safeMemberships = allMemberships
    .map((membership) => toSafeMembership(membership, activeTenantId))
    .filter(Boolean);
  const activeMembership =
    safeMemberships.find((membership) => membership.tenantId === activeTenantId) ??
    safeMemberships.find((membership) => membership.status === 'active') ??
    null;

  return { memberships: safeMemberships, activeMembership };
};

const resolvePendingInvites = async (user) => {
  const now = Date.now();
  const tokens = await runAsSystem(async () =>
    db.findTokens(
      {
        email: user.email,
        type: STARA_TENANT_INVITE,
      },
      {
        sort: { createdAt: -1 },
        limit: 50,
      },
    ),
  );

  return tokens
    .filter((token) => token.expiresAt && new Date(token.expiresAt).getTime() > now)
    .map(toSafeInvite)
    .filter(Boolean)
    .slice(0, MAX_INVITES_TO_RETURN);
};

const resolveGroups = async (user, tenantId) => {
  if (!tenantId || !mongoose.models.Group) {
    return [];
  }

  const memberIds = [
    getObjectIdString(user._id),
    getUserId(user),
    user.idOnTheSource,
    user.email,
    user.username,
  ].filter(Boolean);
  if (!memberIds.length) {
    return [];
  }

  try {
    return await runAsSystem(async () => {
      const groups = await mongoose.models.Group.find({
        tenantId,
        memberIds: { $in: memberIds },
      })
        .select('_id name source idOnTheSource description')
        .limit(50)
        .lean();

      return groups.map((group) => ({
        id: getObjectIdString(group._id),
        name: safeString(group.name, 'Group'),
        source: group.source ?? 'local',
        idOnTheSource: group.idOnTheSource ?? null,
        description: safeString(group.description),
      }));
    });
  } catch (error) {
    logger.warn('[StaraOnboarding] Failed to resolve group summaries', error);
    return [];
  }
};

const resolveGrants = async (user, tenantId) => {
  if (!tenantId || typeof db.getCapabilitiesForPrincipals !== 'function') {
    return [];
  }

  try {
    const principals =
      typeof db.getUserPrincipals === 'function'
        ? await runAsSystem(async () =>
            db.getUserPrincipals({
              userId: user._id ?? getUserId(user),
              role: user.role ?? null,
              idOnTheSource: user.idOnTheSource ?? null,
            }),
          )
        : [{ principalType: PrincipalType.USER, principalId: user._id ?? getUserId(user) }];

    const grants = await db.getCapabilitiesForPrincipals({ principals, tenantId });
    return grants.slice(0, 50).map((grant) => ({
      id: getObjectIdString(grant._id),
      principalType: grant.principalType,
      capability: grant.capability,
      tenantId: grant.tenantId ?? null,
    }));
  } catch (error) {
    logger.warn('[StaraOnboarding] Failed to resolve grant summaries', error);
    return [];
  }
};

const buildContext = async (user) => {
  const latestUser = await runAsSystem(async () =>
    db.getUserById(
      getUserId(user),
      '_id id username email role tenantId idOnTheSource personalization',
    ),
  );
  if (!latestUser) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  const onboarding = normalizeOnboardingState(latestUser.personalization?.staraOnboarding);
  const { memberships, activeMembership } = await resolveMemberships(latestUser);
  const pendingInvites = await resolvePendingInvites(latestUser);
  const tenantId = activeMembership?.tenantId;
  const [groups, grants] = await Promise.all([
    resolveGroups(latestUser, tenantId),
    resolveGrants(latestUser, tenantId),
  ]);
  const accountCompleted = Boolean(onboarding.account?.completedAt);
  const requiresTenantAddendum = Boolean(
    accountCompleted && tenantId && !hasCompletedTenantAddendum(onboarding, tenantId),
  );

  return {
    version: STARA_ONBOARDING_VERSION,
    account: {
      completed: accountCompleted,
      onboarding: onboarding.account ?? null,
    },
    onboarding: sanitizeOnboardingState(onboarding),
    memberships,
    activeMembership,
    pendingInvites,
    access: {
      tenantId: tenantId ?? null,
      scopes: activeMembership?.scopeIds ?? [],
      groups,
      grants,
      restrictedAreas:
        activeMembership && (activeMembership.scopeIds?.length || groups.length || grants.length)
          ? []
          : ['Tenant visibility depends on server-side roles, groups, and grants.'],
    },
    requiresOnboarding: !accountCompleted,
    requiresTenantAddendum,
  };
};

const getStaraOnboardingContextController = async (req, res) => {
  try {
    const context = await buildContext(req.user);
    return res.status(200).json(context);
  } catch (error) {
    logger.error('[StaraOnboarding] Failed to load context', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const saveStaraOnboardingController = async (req, res) => {
  try {
    const user = await runAsSystem(async () =>
      db.getUserById(getUserId(req.user), '_id personalization tenantId'),
    );
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const existing = normalizeOnboardingState(user.personalization?.staraOnboarding);
    const mode = safeString(req.body?.mode);
    const tenantId = safeString(req.body?.tenantId);
    const now = new Date().toISOString();
    const record = {
      completedAt: now,
      mode,
      recommendedStart: safeString(req.body?.recommendedStart, 'chat'),
      readinessScore:
        typeof req.body?.readinessScore === 'number'
          ? Math.max(0, Math.min(100, Math.round(req.body.readinessScore)))
          : undefined,
      responses: sanitizeResponses(req.body?.responses),
      version: STARA_ONBOARDING_VERSION,
    };

    const nextOnboarding = {
      ...existing,
      version: STARA_ONBOARDING_VERSION,
      tenantAddenda: { ...(existing.tenantAddenda ?? {}) },
      updatedAt: now,
    };

    if (mode === 'tenant_addendum') {
      if (!tenantId) {
        return res.status(400).json({ message: 'tenantId is required for tenant addendum' });
      }
      const membership = await db.findTenantMembership({
        userId: getUserId(req.user),
        tenantId,
        status: 'active',
      });
      const legacyTenantMatch = user.tenantId === tenantId;
      if (!membership && !legacyTenantMatch) {
        return res.status(403).json({ message: 'No active tenant membership found' });
      }
      nextOnboarding.tenantAddenda[tenantId] = record;
    } else {
      if (!allowedAccountModes.has(mode)) {
        return res.status(400).json({ message: 'Invalid onboarding mode' });
      }
      nextOnboarding.account = record;
    }

    await runAsSystem(async () =>
      db.updateUser(getUserId(req.user), {
        personalization: {
          ...(user.personalization ?? {}),
          staraOnboarding: nextOnboarding,
        },
      }),
    );

    const context = await buildContext(req.user);
    return res.status(200).json(context);
  } catch (error) {
    logger.error('[StaraOnboarding] Failed to save onboarding', error);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const acceptStaraTenantInviteController = async (req, res) => {
  try {
    const inviteId = safeString(req.params.inviteId);
    if (!inviteId || !mongoose.Types.ObjectId.isValid(inviteId)) {
      return res.status(400).json({ message: 'Invalid invite' });
    }

    const token = await runAsSystem(async () =>
      db.findToken({
        _id: inviteId,
        email: req.user.email,
        type: STARA_TENANT_INVITE,
      }),
    );
    if (!token || new Date(token.expiresAt).getTime() <= Date.now()) {
      return res.status(404).json({ message: 'Invite not found or expired' });
    }

    const tenantId = safeString(token.tenantId ?? getMetadataValue(token.metadata, 'tenantId'));
    if (!tenantId) {
      return res.status(400).json({ message: 'Invite is missing tenant metadata' });
    }

    await db.upsertTenantMembership({
      userId: getUserId(req.user),
      tenantId,
      orgName: safeString(getMetadataValue(token.metadata, 'orgName'), tenantId),
      roleKey: safeString(getMetadataValue(token.metadata, 'roleKey'), 'member'),
      roleLabel: safeString(getMetadataValue(token.metadata, 'roleLabel'), 'Member'),
      status: 'active',
      isDefault: true,
      invitedEmail: req.user.email,
      source: 'invite',
      scopeIds: Array.isArray(getMetadataValue(token.metadata, 'scopeIds'))
        ? getMetadataValue(token.metadata, 'scopeIds')
        : [],
      groupIds: Array.isArray(getMetadataValue(token.metadata, 'groupIds'))
        ? getMetadataValue(token.metadata, 'groupIds')
        : [],
    });
    await runAsSystem(async () => db.updateUser(getUserId(req.user), { tenantId }));
    await runAsSystem(async () => db.deleteTokens({ _id: inviteId }));

    const context = await buildContext({ ...req.user, tenantId });
    return res.status(200).json(context);
  } catch (error) {
    logger.error('[StaraOnboarding] Failed to accept tenant invite', error);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

const activateStaraTenantController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    if (!tenantId) {
      return res.status(400).json({ message: 'tenantId is required' });
    }

    const membership = await db.setDefaultTenantMembership(getUserId(req.user), tenantId);
    const legacyTenantMatch = req.user.tenantId === tenantId;
    if (!membership && !legacyTenantMatch) {
      return res.status(404).json({ message: 'Active tenant membership not found' });
    }

    await runAsSystem(async () => db.updateUser(getUserId(req.user), { tenantId }));

    const context = await buildContext({ ...req.user, tenantId });
    return res.status(200).json(context);
  } catch (error) {
    logger.error('[StaraOnboarding] Failed to activate tenant', error);
    return res.status(500).json({ message: 'Something went wrong.' });
  }
};

module.exports = {
  STARA_TENANT_INVITE,
  getStaraOnboardingContextController,
  saveStaraOnboardingController,
  acceptStaraTenantInviteController,
  activateStaraTenantController,
};
