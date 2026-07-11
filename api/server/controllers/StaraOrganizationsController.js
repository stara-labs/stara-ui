const crypto = require('crypto');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const { PrincipalType } = require('librechat-data-provider');
const { SystemCapabilities, hashToken, logger, runAsSystem } = require('@librechat/data-schemas');
const db = require('~/models');
const { STARA_TENANT_INVITE } = require('./StaraOnboardingController');

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_NAME_LENGTH = 120;

const ROLE_BUNDLES = {
  owner: {
    key: 'owner',
    label: 'Owner',
    description: 'Full org administration, including members, teams, scopes, and roles.',
    canManageOrg: true,
    capabilities: [
      SystemCapabilities.ACCESS_ADMIN,
      SystemCapabilities.MANAGE_USERS,
      SystemCapabilities.MANAGE_GROUPS,
      SystemCapabilities.MANAGE_ROLES,
      SystemCapabilities.MANAGE_CONFIGS,
      SystemCapabilities.ASSIGN_CONFIGS,
      SystemCapabilities.MANAGE_AGENTS,
      SystemCapabilities.MANAGE_MCP_SERVERS,
      SystemCapabilities.MANAGE_PROMPTS,
      SystemCapabilities.MANAGE_SKILLS,
      SystemCapabilities.MANAGE_SHARED_LINKS,
      SystemCapabilities.MANAGE_ASSISTANTS,
      SystemCapabilities.READ_USAGE,
      SystemCapabilities.READ_AUDIT_LOG,
    ],
  },
  admin: {
    key: 'admin',
    label: 'Admin',
    description: 'Manage members, teams, invites, and scoped access.',
    canManageOrg: true,
    capabilities: [
      SystemCapabilities.ACCESS_ADMIN,
      SystemCapabilities.MANAGE_USERS,
      SystemCapabilities.MANAGE_GROUPS,
      SystemCapabilities.MANAGE_ROLES,
      SystemCapabilities.MANAGE_AGENTS,
      SystemCapabilities.MANAGE_PROMPTS,
      SystemCapabilities.MANAGE_SKILLS,
      SystemCapabilities.MANAGE_SHARED_LINKS,
      SystemCapabilities.READ_USAGE,
    ],
  },
  member: {
    key: 'member',
    label: 'Member',
    description: 'Normal tenant use without org administration.',
    canManageOrg: false,
    capabilities: [],
  },
  viewer: {
    key: 'viewer',
    label: 'Viewer',
    description: 'Read-only tenant visibility where supported.',
    canManageOrg: false,
    capabilities: [],
  },
};

const ROLE_CAPABILITY_SET = new Set(
  Object.values(ROLE_BUNDLES).flatMap((bundle) => bundle.capabilities),
);

const SCOPE_OPTIONS = [
  { id: 'memory', label: 'Memory', description: 'Tenant memory layers and knowledge context.' },
  { id: 'agents', label: 'Agents', description: 'Tenant agents and agent configuration.' },
  { id: 'workflows', label: 'Workflows', description: 'Workflow runs, routing, and automation.' },
  {
    id: 'source_systems',
    label: 'Source systems',
    description: 'Connected data sources, vaults, and integrations.',
  },
  {
    id: 'approval_lanes',
    label: 'Approval lanes',
    description: 'Review queues, policy approvals, and handoffs.',
  },
  {
    id: 'observability',
    label: 'Observability',
    description: 'Tenant logs, metrics, traces, and audit summaries.',
  },
];

const ALL_SCOPE_IDS = SCOPE_OPTIONS.map((scope) => scope.id);

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

const safeString = (value, fallback = undefined, maxLength = 512) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, maxLength);
};

const normalizeEmail = (email) => safeString(email, '', 320).toLowerCase();

const normalizeRoleKey = (value, fallback = 'member') => (ROLE_BUNDLES[value] ? value : fallback);

const normalizeScopeIds = (scopeIds, fallback = []) => {
  if (!Array.isArray(scopeIds)) {
    return fallback;
  }
  const allowed = new Set(ALL_SCOPE_IDS);
  return [...new Set(scopeIds.filter((scopeId) => allowed.has(scopeId)))];
};

const normalizeIdList = (values) =>
  Array.isArray(values)
    ? [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))]
    : [];

const slugify = (value) =>
  safeString(value, 'org', MAX_NAME_LENGTH)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'org';

const newTenantId = () => `ten_${crypto.randomBytes(8).toString('hex')}`;

const publicAppUrl = () =>
  (process.env.APP_PUBLIC_URL || process.env.DOMAIN_CLIENT || '').replace(/\/+$/, '');

const buildInviteLink = (rawToken) => {
  const base = publicAppUrl();
  const path = `/organizations/invite?token=${encodeURIComponent(rawToken)}`;
  return base ? `${base}${path}` : path;
};

const staraApiBaseUrl = () =>
  safeString(process.env.STARA_API_URL ?? process.env.STARA_API_BASE_URL, '', 2048).replace(
    /\/+$/,
    '',
  );

const isStaraApiConfigured = () => Boolean(staraApiBaseUrl());

const staraApiHeaders = (user) => ({
  'Content-Type': 'application/json',
  'x-stara-user-id': getUserId(user),
  'x-stara-actor-id': getUserId(user),
  'x-stara-actor-email': normalizeEmail(user?.email),
  'x-stara-email-verified': user?.emailVerified ? 'true' : 'false',
  'x-stara-mfa-enrolled': user?.twoFactorEnabled ? 'true' : 'false',
  ...(user?.tenantId ? { 'x-stara-tenant-id': user.tenantId } : {}),
});

const callStaraApi = async (user, path, options = {}) => {
  const baseUrl = staraApiBaseUrl();
  if (!baseUrl) {
    const error = new Error('STARA_API_URL is not configured');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: staraApiHeaders(user),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(payload.message ?? payload.error ?? 'Stara API request failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const apiTenantId = (orgOrTenant) => orgOrTenant?.tenant_id ?? orgOrTenant?.tenantId;

const apiRoleKey = (member) => normalizeRoleKey(member?.role_key ?? member?.roleKey);

const apiScopeIds = (member, fallbackRoleKey = 'member') => {
  const fromApi = normalizeScopeIds(member?.scope_ids ?? member?.scopeIds);
  if (fromApi.length) {
    return fromApi;
  }
  return ['owner', 'admin'].includes(fallbackRoleKey) ? ALL_SCOPE_IDS : [];
};

const apiOrgStatusToLocal = (status) => (status === 'disabled' ? 'disabled' : 'active');

const toMemberSummaryFromStaraApi = (member, org, userMap, localMembershipMap) => {
  const userId = safeString(member.user_id);
  const user = userMap.get(userId);
  const localMembership = localMembershipMap.get(userId);
  const roleKey = apiRoleKey(member);
  return {
    userId,
    email: safeString(user?.email ?? member.email),
    name: safeString(user?.name ?? user?.username ?? member.display_name ?? member.email, 'Member'),
    username: safeString(user?.username),
    avatar: safeString(user?.avatar),
    tenantId: member.tenant_id,
    orgName: safeString(org?.name ?? localMembership?.orgName, member.tenant_id),
    roleKey,
    roleLabel: ROLE_BUNDLES[roleKey].label,
    status: member.status ?? 'active',
    isDefault: Boolean(localMembership?.isDefault),
    scopeIds: localMembership?.scopeIds?.length
      ? localMembership.scopeIds
      : apiScopeIds(member, roleKey),
    groupIds: Array.isArray(localMembership?.groupIds) ? localMembership.groupIds : [],
    createdAt: member.joined_at ?? localMembership?.createdAt ?? null,
    updatedAt: member.updated_at ?? localMembership?.updatedAt ?? null,
  };
};

const toInviteSummaryFromStaraApi = (invite, org, invitedByName) => {
  const roleKey = apiRoleKey(invite);
  return {
    id: invite.invite_id,
    tenantId: invite.tenant_id,
    email: normalizeEmail(invite.email),
    roleKey,
    roleLabel: ROLE_BUNDLES[roleKey].label,
    scopeIds: apiScopeIds(invite, roleKey),
    groupIds: [],
    status: invite.status === 'accepted' ? 'consumed' : invite.status,
    invitedByName,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at,
    orgName: safeString(org?.name, invite.tenant_id),
  };
};

const ensureTenantMirror = async ({ org, createdBy }) => {
  const tenantId = apiTenantId(org);
  const existing = await db.findTenant({ tenantId });
  const data = {
    tenantId,
    name: safeString(org.name, tenantId, MAX_NAME_LENGTH),
    slug: safeString(org.slug, tenantId, 80),
    status: apiOrgStatusToLocal(org.status),
    createdBy,
  };

  if (existing) {
    return db.updateTenant({ tenantId }, data);
  }

  return db.createTenant(data);
};

const mirrorStaraApiMembership = async ({ user, org, membership, isDefault = false }) => {
  const userId = safeString(membership?.user_id, getUserId(user));
  const roleKey = apiRoleKey(membership);
  const tenant = await ensureTenantMirror({ org, createdBy: getUserId(user) });
  const localMembership = await db.upsertTenantMembership({
    userId,
    tenantId: apiTenantId(org),
    orgName: tenant?.name ?? org.name,
    roleKey,
    roleLabel: ROLE_BUNDLES[roleKey].label,
    status: membership?.status ?? 'active',
    isDefault,
    invitedEmail: normalizeEmail(membership?.email),
    source: 'stara',
    scopeIds: apiScopeIds(membership, roleKey),
    groupIds: [],
  });
  await applyRoleGrants({
    tenantId: apiTenantId(org),
    userId,
    roleKey,
    grantedBy: getUserId(user),
  });
  return localMembership;
};

const syncStaraApiOrgsToMongo = async (user) => {
  if (!isStaraApiConfigured()) {
    return;
  }
  const response = await callStaraApi(user, '/v1/orgs');
  for (const entry of response.orgs ?? []) {
    await mirrorStaraApiMembership({
      user,
      org: entry.org,
      membership: entry.membership,
      isDefault: entry.org?.tenant_id === user?.tenantId,
    });
  }
};

const loadStaraApiUser = async (user) => {
  const latestUser = await runAsSystem(async () =>
    db.getUserById(
      getUserId(user),
      '_id id email username name tenantId idOnTheSource emailVerified twoFactorEnabled',
    ),
  );
  return { ...(latestUser ?? user), tenantId: user?.tenantId ?? latestUser?.tenantId };
};

const toRoleBundleSummary = (bundle) => ({
  key: bundle.key,
  label: bundle.label,
  description: bundle.description,
  canManageOrg: bundle.canManageOrg,
});

const toTenantSummary = (tenant, membership) => ({
  tenantId: membership?.tenantId ?? tenant?.tenantId,
  name: safeString(tenant?.name ?? membership?.orgName, membership?.tenantId),
  slug: safeString(tenant?.slug),
  status: tenant?.status ?? 'active',
  roleKey: normalizeRoleKey(membership?.roleKey),
  roleLabel: safeString(
    membership?.roleLabel,
    ROLE_BUNDLES[normalizeRoleKey(membership?.roleKey)].label,
  ),
  isDefault: Boolean(membership?.isDefault),
  createdAt: tenant?.createdAt ?? membership?.createdAt ?? null,
  updatedAt: tenant?.updatedAt ?? membership?.updatedAt ?? null,
});

const toMemberSummary = (membership, userMap) => {
  const userId = getObjectIdString(membership.userId);
  const user = userMap.get(userId);
  const roleKey = normalizeRoleKey(membership.roleKey);
  return {
    userId,
    email: safeString(user?.email ?? membership.invitedEmail),
    name: safeString(user?.name ?? user?.username ?? user?.email, 'Member'),
    username: safeString(user?.username),
    avatar: safeString(user?.avatar),
    tenantId: membership.tenantId,
    orgName: safeString(membership.orgName, membership.tenantId),
    roleKey,
    roleLabel: safeString(membership.roleLabel, ROLE_BUNDLES[roleKey].label),
    status: membership.status ?? 'active',
    isDefault: Boolean(membership.isDefault),
    scopeIds: Array.isArray(membership.scopeIds) ? membership.scopeIds : [],
    groupIds: Array.isArray(membership.groupIds) ? membership.groupIds : [],
    createdAt: membership.createdAt ?? null,
    updatedAt: membership.updatedAt ?? null,
  };
};

const toTeamSummary = (group) => ({
  id: getObjectIdString(group._id),
  name: safeString(group.name, 'Team'),
  description: safeString(group.description, ''),
  memberIds: Array.isArray(group.memberIds) ? group.memberIds : [],
  source: group.source ?? 'local',
  createdAt: group.createdAt ?? null,
  updatedAt: group.updatedAt ?? null,
});

const toInviteSummary = (token) => {
  const metadata = token.metadata;
  const roleKey = normalizeRoleKey(getMetadataValue(metadata, 'roleKey'));
  return {
    id: getObjectIdString(token._id),
    tenantId: token.tenantId ?? getMetadataValue(metadata, 'tenantId'),
    email: normalizeEmail(token.email),
    roleKey,
    roleLabel: safeString(getMetadataValue(metadata, 'roleLabel'), ROLE_BUNDLES[roleKey].label),
    scopeIds: normalizeScopeIds(getMetadataValue(metadata, 'scopeIds')),
    groupIds: normalizeIdList(getMetadataValue(metadata, 'groupIds')),
    status: safeString(getMetadataValue(metadata, 'status'), 'pending'),
    invitedByName: safeString(getMetadataValue(metadata, 'invitedByName')),
    expiresAt: token.expiresAt,
    createdAt: token.createdAt,
  };
};

const getTenantMembership = async (userId, tenantId) =>
  db.findTenantMembership({ userId, tenantId, status: 'active' });

const assertCanManageOrg = async (user, tenantId) => {
  const membership = await getTenantMembership(getUserId(user), tenantId);
  if (!membership || !['owner', 'admin'].includes(membership.roleKey)) {
    const error = new Error('You do not have permission to manage this org');
    error.status = 403;
    throw error;
  }
  return membership;
};

const assertCanViewOrg = async (user, tenantId) => {
  const membership = await getTenantMembership(getUserId(user), tenantId);
  if (!membership) {
    const error = new Error('Org membership not found');
    error.status = 404;
    throw error;
  }
  return membership;
};

const assertLastOwnerSafe = async ({ tenantId, userId, nextRoleKey, nextStatus }) => {
  const existing = await db.findTenantMembership({ tenantId, userId });
  if (!existing || existing.roleKey !== 'owner' || existing.status !== 'active') {
    return;
  }
  const demotesOwner = nextRoleKey && nextRoleKey !== 'owner';
  const disablesOwner = nextStatus && nextStatus !== 'active';
  if (!demotesOwner && !disablesOwner) {
    return;
  }
  const owners = await db.listTenantMemberships({
    tenantId,
    roleKey: 'owner',
    status: 'active',
  });
  if (owners.length <= 1) {
    const error = new Error('The last owner cannot be removed or demoted');
    error.status = 400;
    throw error;
  }
};

const applyRoleGrants = async ({ tenantId, userId, roleKey, grantedBy }) => {
  await runAsSystem(async () => {
    for (const capability of ROLE_CAPABILITY_SET) {
      await db.revokeCapability({
        principalType: PrincipalType.USER,
        principalId: userId,
        capability,
        tenantId,
      });
    }
    for (const capability of ROLE_BUNDLES[roleKey].capabilities) {
      await db.grantCapability({
        principalType: PrincipalType.USER,
        principalId: userId,
        capability,
        tenantId,
        grantedBy,
      });
    }
  });
};

const loadUsersById = async (userIds) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) {
    return new Map();
  }
  const objectIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const users = await runAsSystem(async () =>
    db.findUsers({ _id: { $in: objectIds } }, '_id email name username avatar idOnTheSource', {
      limit: Math.max(objectIds.length, 1),
    }),
  );
  return new Map(users.map((user) => [getObjectIdString(user._id), user]));
};

const loadTenantTeams = async (tenantId) =>
  runAsSystem(async () => {
    if (!mongoose.models.Group) {
      return [];
    }
    const groups = await mongoose.models.Group.find({ tenantId, source: 'local' })
      .sort({ name: 1 })
      .limit(200)
      .lean();
    return groups.map(toTeamSummary);
  });

const loadPendingInvites = async (tenantId) =>
  runAsSystem(async () => {
    const tokens = await db.findTokens(
      { tenantId, type: STARA_TENANT_INVITE },
      { sort: { createdAt: -1 }, limit: 100 },
    );
    const now = Date.now();
    return tokens
      .filter((token) => token.expiresAt && new Date(token.expiresAt).getTime() > now)
      .map(toInviteSummary)
      .filter((invite) => invite.status === 'pending');
  });

const buildOrganizationsContext = async (user) => {
  const latestUser = await runAsSystem(async () =>
    db.getUserById(
      getUserId(user),
      '_id email username name tenantId idOnTheSource personalization emailVerified twoFactorEnabled',
    ),
  );
  if (!latestUser) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  await syncStaraApiOrgsToMongo(latestUser);

  const memberships = await db.listTenantMemberships({
    userId: getUserId(latestUser),
    status: ['active', 'invited', 'disabled'],
  });
  const activeTenantId =
    safeString(latestUser.tenantId) ??
    memberships.find((membership) => membership.isDefault && membership.status === 'active')
      ?.tenantId ??
    memberships.find((membership) => membership.status === 'active')?.tenantId;
  const tenantIds = [...new Set(memberships.map((membership) => membership.tenantId))];
  const tenants = await db.listTenants({ tenantId: tenantIds });
  const tenantMap = new Map(tenants.map((tenant) => [tenant.tenantId, tenant]));
  const orgs = memberships.map((membership) =>
    toTenantSummary(tenantMap.get(membership.tenantId), membership),
  );
  const activeMembership =
    memberships.find((membership) => membership.tenantId === activeTenantId) ??
    memberships.find((membership) => membership.status === 'active') ??
    null;
  const activeOrg = activeMembership
    ? toTenantSummary(tenantMap.get(activeMembership.tenantId), activeMembership)
    : null;
  const canManage = Boolean(
    activeMembership && ['owner', 'admin'].includes(activeMembership.roleKey),
  );

  let members = [];
  let teams = [];
  let invites = [];
  if (activeMembership) {
    const tenantMemberships = await db.listTenantMemberships({
      tenantId: activeMembership.tenantId,
      status: ['active', 'invited', 'disabled'],
    });
    const userMap = await loadUsersById(
      tenantMemberships.map((membership) => getObjectIdString(membership.userId)),
    );
    members = tenantMemberships.map((membership) => toMemberSummary(membership, userMap));
    teams = await loadTenantTeams(activeMembership.tenantId);
    invites = canManage ? await loadPendingInvites(activeMembership.tenantId) : [];
  }

  return {
    activeOrg,
    orgs,
    members,
    invites,
    teams,
    roleBundles: Object.values(ROLE_BUNDLES).map(toRoleBundleSummary),
    scopeOptions: SCOPE_OPTIONS,
    scopedAccess: {
      tenantId: activeMembership?.tenantId ?? null,
      scopeIds: activeMembership?.scopeIds ?? [],
      groupIds: activeMembership?.groupIds ?? [],
      restrictedAreas:
        activeMembership && (activeMembership.scopeIds?.length || activeMembership.groupIds?.length)
          ? []
          : ['Access is resolved server-side from role bundles, teams, and scopes.'],
    },
    permissions: {
      canCreateOrg: true,
      canManageMembers: canManage,
      canManageInvites: canManage,
      canManageTeams: canManage,
      canManageScopes: canManage,
    },
  };
};

const sendInviteEmail = async ({ email, orgName, inviterName, inviteLink }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return { sent: false, reason: 'resend_not_configured' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${inviterName || 'Someone'} invited you to ${orgName} on Stara`,
      html: [
        `<p>${inviterName || 'Someone'} invited you to join ${orgName} on Stara.</p>`,
        `<p><a href="${inviteLink}">Accept your invite</a></p>`,
        '<p>This invite expires in 7 days.</p>',
      ].join(''),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend failed with ${response.status}: ${text.slice(0, 300)}`);
  }
  return { sent: true };
};

const getOrganizationsContextController = async (req, res) => {
  try {
    return res.status(200).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to load context', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const createOrganizationController = async (req, res) => {
  try {
    const name = safeString(req.body?.name, undefined, MAX_NAME_LENGTH);
    if (!name || name.length < 2) {
      return res.status(400).json({ message: 'Org name must be at least 2 characters' });
    }

    if (isStaraApiConfigured()) {
      const apiUser = await loadStaraApiUser(req.user);
      const created = await callStaraApi(apiUser, '/v1/orgs', {
        method: 'POST',
        body: { name },
      });
      const tenantId = created.org.tenant_id;
      const activated = await callStaraApi(
        { ...apiUser, tenantId },
        `/v1/orgs/${tenantId}/activate`,
        {
          method: 'POST',
        },
      );
      await mirrorStaraApiMembership({
        user: apiUser,
        org: activated.org ?? created.org,
        membership: created.membership,
        isDefault: true,
      });
      await runAsSystem(async () => db.updateUser(getUserId(apiUser), { tenantId }));

      return res.status(201).json(await buildOrganizationsContext({ ...apiUser, tenantId }));
    }

    const tenantId = newTenantId();
    const slug = `${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;
    const tenant = await db.createTenant({
      tenantId,
      name,
      slug,
      status: 'active',
      createdBy: getUserId(req.user),
    });
    await db.upsertTenantMembership({
      userId: getUserId(req.user),
      tenantId,
      orgName: tenant.name,
      roleKey: 'owner',
      roleLabel: ROLE_BUNDLES.owner.label,
      status: 'active',
      isDefault: true,
      source: 'stara',
      scopeIds: ALL_SCOPE_IDS,
      groupIds: [],
    });
    await runAsSystem(async () => db.updateUser(getUserId(req.user), { tenantId }));
    await applyRoleGrants({
      tenantId,
      userId: getUserId(req.user),
      roleKey: 'owner',
      grantedBy: getUserId(req.user),
    });

    return res.status(201).json(await buildOrganizationsContext({ ...req.user, tenantId }));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to create org', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const activateOrganizationController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    if (isStaraApiConfigured()) {
      const apiUser = await loadStaraApiUser({ ...req.user, tenantId });
      await callStaraApi(apiUser, `/v1/orgs/${tenantId}/activate`, {
        method: 'POST',
      });
      const remoteOrgs = await callStaraApi(apiUser, '/v1/orgs');
      const entry = (remoteOrgs.orgs ?? []).find(
        (candidate) => candidate.org?.tenant_id === tenantId,
      );
      if (entry) {
        await mirrorStaraApiMembership({
          user: apiUser,
          org: entry.org,
          membership: entry.membership,
          isDefault: true,
        });
      }
      await runAsSystem(async () => db.updateUser(getUserId(apiUser), { tenantId }));
      return res.status(200).json(await buildOrganizationsContext(apiUser));
    }

    await assertCanViewOrg(req.user, tenantId);
    const membership = await db.setDefaultTenantMembership(getUserId(req.user), tenantId);
    if (!membership) {
      return res.status(404).json({ message: 'Active org membership not found' });
    }
    await runAsSystem(async () => db.updateUser(getUserId(req.user), { tenantId }));
    return res.status(200).json(await buildOrganizationsContext({ ...req.user, tenantId }));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to activate org', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const listMembersController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    if (isStaraApiConfigured()) {
      const apiUser = await loadStaraApiUser({ ...req.user, tenantId });
      await assertCanViewOrg(req.user, tenantId);
      const [response, tenant, localMemberships] = await Promise.all([
        callStaraApi(apiUser, `/v1/orgs/${tenantId}/members`),
        db.findTenant({ tenantId }),
        db.listTenantMemberships({ tenantId, status: ['active', 'invited', 'disabled'] }),
      ]);
      const userMap = await loadUsersById((response.members ?? []).map((member) => member.user_id));
      const localMembershipMap = new Map(
        localMemberships.map((membership) => [getObjectIdString(membership.userId), membership]),
      );
      return res
        .status(200)
        .json(
          (response.members ?? []).map((member) =>
            toMemberSummaryFromStaraApi(member, tenant, userMap, localMembershipMap),
          ),
        );
    }

    await assertCanViewOrg(req.user, tenantId);
    const memberships = await db.listTenantMemberships({
      tenantId,
      status: ['active', 'invited', 'disabled'],
    });
    const userMap = await loadUsersById(
      memberships.map((membership) => getObjectIdString(membership.userId)),
    );
    return res
      .status(200)
      .json(memberships.map((membership) => toMemberSummary(membership, userMap)));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to list members', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const updateMemberController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const memberUserId = safeString(req.params.userId);
    if (isStaraApiConfigured()) {
      const apiUser = await loadStaraApiUser({ ...req.user, tenantId });
      await assertCanManageOrg(req.user, tenantId);
      const roleKey = req.body?.roleKey ? normalizeRoleKey(req.body.roleKey) : undefined;
      const body = {};
      if (roleKey) {
        body.role_key = roleKey;
      }
      if (req.body?.status) {
        body.status = req.body.status;
      }
      if (req.body?.scopeIds !== undefined) {
        body.scope_ids = normalizeScopeIds(req.body.scopeIds);
      }
      const response = await callStaraApi(apiUser, `/v1/orgs/${tenantId}/members/${memberUserId}`, {
        method: 'PATCH',
        body,
      });
      const tenant = await db.findTenant({ tenantId });
      await mirrorStaraApiMembership({
        user: apiUser,
        org: tenant ?? { tenant_id: tenantId, name: tenantId, slug: tenantId, status: 'active' },
        membership: response.member,
        isDefault: response.member.user_id === getUserId(apiUser) && apiUser.tenantId === tenantId,
      });

      return res.status(200).json(await buildOrganizationsContext(apiUser));
    }

    await assertCanManageOrg(req.user, tenantId);
    const roleKey = req.body?.roleKey ? normalizeRoleKey(req.body.roleKey) : undefined;
    const nextStatus = req.body?.status;
    if (nextStatus && !['active', 'invited', 'disabled'].includes(nextStatus)) {
      return res.status(400).json({ message: 'Invalid member status' });
    }
    await assertLastOwnerSafe({ tenantId, userId: memberUserId, nextRoleKey: roleKey, nextStatus });
    const update = {};
    if (roleKey) {
      update.roleKey = roleKey;
      update.roleLabel = ROLE_BUNDLES[roleKey].label;
    }
    if (nextStatus) {
      update.status = nextStatus;
    }
    if (req.body?.scopeIds !== undefined) {
      update.scopeIds = normalizeScopeIds(req.body.scopeIds);
    }
    if (req.body?.groupIds !== undefined) {
      update.groupIds = normalizeIdList(req.body.groupIds);
    }
    const membership = await db.updateTenantMembership({ tenantId, userId: memberUserId }, update);
    if (!membership) {
      return res.status(404).json({ message: 'Member not found' });
    }
    if (roleKey) {
      await applyRoleGrants({
        tenantId,
        userId: memberUserId,
        roleKey,
        grantedBy: getUserId(req.user),
      });
    }
    return res.status(200).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to update member', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const disableMemberController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const memberUserId = safeString(req.params.userId);
    if (isStaraApiConfigured()) {
      const apiUser = await loadStaraApiUser({ ...req.user, tenantId });
      await assertCanManageOrg(req.user, tenantId);
      const response = await callStaraApi(apiUser, `/v1/orgs/${tenantId}/members/${memberUserId}`, {
        method: 'PATCH',
        body: { status: 'disabled' },
      });
      await db.updateTenantMembership(
        { tenantId, userId: memberUserId },
        { status: response.member?.status ?? 'disabled', isDefault: false },
      );
      await applyRoleGrants({
        tenantId,
        userId: memberUserId,
        roleKey: 'member',
        grantedBy: getUserId(apiUser),
      });
      return res.status(200).json(await buildOrganizationsContext(apiUser));
    }

    await assertCanManageOrg(req.user, tenantId);
    await assertLastOwnerSafe({ tenantId, userId: memberUserId, nextStatus: 'disabled' });
    const membership = await db.updateTenantMembership(
      { tenantId, userId: memberUserId },
      { status: 'disabled', isDefault: false },
    );
    if (!membership) {
      return res.status(404).json({ message: 'Member not found' });
    }
    await applyRoleGrants({
      tenantId,
      userId: memberUserId,
      roleKey: 'member',
      grantedBy: getUserId(req.user),
    });
    return res.status(200).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to disable member', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const createInviteController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const adminMembership = await assertCanManageOrg(req.user, tenantId);
    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'A valid email is required' });
    }
    const roleKey = normalizeRoleKey(req.body?.roleKey);
    const tenant = await db.findTenant({ tenantId });
    if (!tenant || tenant.status !== 'active') {
      return res.status(404).json({ message: 'Org not found' });
    }

    if (isStaraApiConfigured()) {
      const apiUser = await loadStaraApiUser({ ...req.user, tenantId });
      const invitedByName = safeString(
        apiUser?.name ?? apiUser?.username ?? apiUser?.email,
        'A Stara user',
      );
      const response = await callStaraApi(apiUser, `/v1/orgs/${tenantId}/invites`, {
        method: 'POST',
        body: {
          email,
          role_key: roleKey,
          scope_ids: normalizeScopeIds(
            req.body?.scopeIds,
            roleKey === 'owner' ? ALL_SCOPE_IDS : [],
          ),
          expires_in_days: 7,
        },
      });
      const inviteLink = buildInviteLink(response.token);
      let delivery = { sent: false, reason: 'resend_not_configured' };
      try {
        delivery = await sendInviteEmail({
          email,
          orgName: tenant.name,
          inviterName: invitedByName,
          inviteLink,
        });
      } catch (error) {
        logger.warn('[StaraOrganizations] Invite email failed; returning fallback link', error);
        delivery = { sent: false, reason: 'resend_failed' };
      }

      return res.status(201).json({
        invite: toInviteSummaryFromStaraApi(response.invite, tenant, invitedByName),
        delivery,
        inviteLink: delivery.sent ? undefined : inviteLink,
        context: await buildOrganizationsContext({
          ...apiUser,
          tenantId: adminMembership.tenantId,
        }),
      });
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = await hashToken(rawToken);
    const inviteLink = buildInviteLink(rawToken);
    const invitedByName = safeString(
      req.user?.name ?? req.user?.username ?? req.user?.email,
      'A Stara user',
    );
    const metadata = {
      tenantId,
      orgName: tenant.name,
      roleKey,
      roleLabel: ROLE_BUNDLES[roleKey].label,
      scopeIds: normalizeScopeIds(req.body?.scopeIds, roleKey === 'owner' ? ALL_SCOPE_IDS : []),
      groupIds: normalizeIdList(req.body?.groupIds),
      invitedByName,
      invitedByUserId: getUserId(req.user),
      status: 'pending',
    };
    const token = await runAsSystem(async () =>
      db.createToken({
        userId: getUserId(req.user),
        email,
        token: tokenHash,
        type: STARA_TENANT_INVITE,
        tenantId,
        expiresIn: INVITE_TTL_SECONDS,
        metadata,
      }),
    );
    let delivery = { sent: false, reason: 'resend_not_configured' };
    try {
      delivery = await sendInviteEmail({
        email,
        orgName: tenant.name,
        inviterName: invitedByName,
        inviteLink,
      });
    } catch (error) {
      logger.warn('[StaraOrganizations] Invite email failed; returning fallback link', error);
      delivery = { sent: false, reason: 'resend_failed' };
    }

    return res.status(201).json({
      invite: toInviteSummary(token),
      delivery,
      inviteLink: delivery.sent ? undefined : inviteLink,
      context: await buildOrganizationsContext({ ...req.user, tenantId: adminMembership.tenantId }),
    });
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to create invite', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const acceptInviteController = async (req, res) => {
  try {
    const rawToken = safeString(req.body?.token, undefined, 2048);
    if (!rawToken) {
      return res.status(400).json({ message: 'Invite token is required' });
    }
    if (isStaraApiConfigured()) {
      const apiUser = await loadStaraApiUser(req.user);
      const accepted = await callStaraApi(apiUser, '/v1/orgs/invites/accept', {
        method: 'POST',
        body: { token: rawToken },
      });
      await mirrorStaraApiMembership({
        user: apiUser,
        org: accepted.org,
        membership: accepted.membership,
        isDefault: true,
      });
      const tenantId = accepted.org.tenant_id;
      const roleKey = apiRoleKey(accepted.membership);
      await runAsSystem(async () => db.updateUser(getUserId(apiUser), { tenantId }));
      await applyRoleGrants({
        tenantId,
        userId: getUserId(apiUser),
        roleKey,
        grantedBy: accepted.invite?.created_by_user_id,
      });
      return res.status(200).json(await buildOrganizationsContext({ ...apiUser, tenantId }));
    }

    const tokenHash = await hashToken(rawToken);
    const token = await runAsSystem(async () =>
      db.findToken({ token: tokenHash, type: STARA_TENANT_INVITE }),
    );
    if (!token || !token.expiresAt || new Date(token.expiresAt).getTime() <= Date.now()) {
      return res.status(404).json({ message: 'Invite not found or expired' });
    }
    const email = normalizeEmail(token.email);
    if (email && email !== normalizeEmail(req.user.email)) {
      return res.status(403).json({ message: 'This invite was sent to a different email' });
    }
    const metadata = token.metadata;
    if (getMetadataValue(metadata, 'status') !== 'pending') {
      return res.status(400).json({ message: 'Invite is no longer pending' });
    }
    const tenantId = safeString(token.tenantId ?? getMetadataValue(metadata, 'tenantId'));
    const tenant = await db.findTenant({ tenantId, status: 'active' });
    if (!tenant) {
      return res.status(404).json({ message: 'Org not found' });
    }
    const roleKey = normalizeRoleKey(getMetadataValue(metadata, 'roleKey'));
    await db.upsertTenantMembership({
      userId: getUserId(req.user),
      tenantId,
      orgName: tenant.name,
      roleKey,
      roleLabel: ROLE_BUNDLES[roleKey].label,
      status: 'active',
      isDefault: true,
      invitedEmail: email,
      source: 'invite',
      scopeIds: normalizeScopeIds(getMetadataValue(metadata, 'scopeIds')),
      groupIds: normalizeIdList(getMetadataValue(metadata, 'groupIds')),
    });
    await runAsSystem(async () => db.updateUser(getUserId(req.user), { tenantId }));
    await applyRoleGrants({
      tenantId,
      userId: getUserId(req.user),
      roleKey,
      grantedBy: getMetadataValue(metadata, 'invitedByUserId'),
    });
    await runAsSystem(async () => db.deleteTokens({ _id: getObjectIdString(token._id) }));
    return res.status(200).json(await buildOrganizationsContext({ ...req.user, tenantId }));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to accept invite', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const revokeInviteController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const inviteId = safeString(req.params.inviteId);
    await assertCanManageOrg(req.user, tenantId);
    await runAsSystem(async () =>
      db.deleteTokens({ _id: inviteId, tenantId, type: STARA_TENANT_INVITE }),
    );
    return res.status(200).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to revoke invite', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const createTeamController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    await assertCanManageOrg(req.user, tenantId);
    const name = safeString(req.body?.name, undefined, MAX_NAME_LENGTH);
    if (!name) {
      return res.status(400).json({ message: 'Team name is required' });
    }
    await runAsSystem(async () =>
      db.createGroup({
        tenantId,
        name,
        description: safeString(req.body?.description, ''),
        source: 'local',
        memberIds: normalizeIdList(req.body?.memberIds),
      }),
    );
    return res.status(201).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to create team', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const updateTeamController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const teamId = safeString(req.params.teamId);
    await assertCanManageOrg(req.user, tenantId);
    const group = await runAsSystem(async () =>
      mongoose.models.Group.findOne({ _id: teamId, tenantId, source: 'local' }).lean(),
    );
    if (!group) {
      return res.status(404).json({ message: 'Team not found' });
    }
    const update = {};
    if (req.body?.name !== undefined) {
      update.name = safeString(req.body.name, group.name, MAX_NAME_LENGTH);
    }
    if (req.body?.description !== undefined) {
      update.description = safeString(req.body.description, '');
    }
    if (req.body?.memberIds !== undefined) {
      update.memberIds = normalizeIdList(req.body.memberIds);
    }
    await runAsSystem(async () => db.updateGroupById(teamId, update));
    return res.status(200).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to update team', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

const deleteTeamController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const teamId = safeString(req.params.teamId);
    await assertCanManageOrg(req.user, tenantId);
    const group = await runAsSystem(async () =>
      mongoose.models.Group.findOne({ _id: teamId, tenantId, source: 'local' }).lean(),
    );
    if (!group) {
      return res.status(404).json({ message: 'Team not found' });
    }
    await runAsSystem(async () => db.deleteGroup(teamId));
    return res.status(200).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    logger.error('[StaraOrganizations] Failed to delete team', error);
    return res
      .status(error.status ?? 500)
      .json({ message: error.message ?? 'Something went wrong.' });
  }
};

module.exports = {
  ROLE_BUNDLES,
  SCOPE_OPTIONS,
  getOrganizationsContextController,
  createOrganizationController,
  activateOrganizationController,
  listMembersController,
  updateMemberController,
  disableMemberController,
  createInviteController,
  acceptInviteController,
  revokeInviteController,
  createTeamController,
  updateTeamController,
  deleteTeamController,
};
