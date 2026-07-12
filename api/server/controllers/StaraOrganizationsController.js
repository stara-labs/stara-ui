const fetch = require('node-fetch');
const { logger } = require('@librechat/data-schemas');
const {
  callStaraApi,
  loadStaraUser,
  normalizeEmail,
  safeString,
  setCompatibilityTenant,
} = require('~/server/services/StaraApiClient');

const MAX_NAME_LENGTH = 120;
const ROLE_KEYS = new Set(['owner', 'admin', 'member', 'viewer']);

const normalizeRoleKey = (value) => (ROLE_KEYS.has(value) ? value : 'member');
const normalizeStringList = (values) =>
  Array.isArray(values)
    ? [
        ...new Set(
          values
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
    : [];

const roleCatalog = (accessOptions) => {
  const roles = (accessOptions.role_bundles ?? []).map((role) => ({
    key: normalizeRoleKey(role.key),
    label: safeString(role.label, role.key),
    description: safeString(role.description, role.key),
    canManageOrg: Boolean(role.can_manage_org),
  }));
  const keys = new Set(roles.map((role) => role.key));
  if (![...ROLE_KEYS].every((key) => keys.has(key))) {
    const error = new Error('The organization role catalog is unavailable');
    error.status = 503;
    throw error;
  }
  return roles;
};

const roleMapFrom = (roles) => new Map(roles.map((role) => [role.key, role]));

const mapOrg = (entry, roleMap, activeTenantId) => {
  const roleKey = normalizeRoleKey(entry.membership?.role_key);
  return {
    tenantId: entry.org?.tenant_id,
    name: safeString(entry.org?.name, entry.org?.tenant_id),
    slug: safeString(entry.org?.slug),
    status: entry.org?.status === 'disabled' ? 'disabled' : 'active',
    roleKey,
    roleLabel: roleMap.get(roleKey)?.label ?? roleKey,
    isDefault: entry.org?.tenant_id === activeTenantId,
    createdAt: entry.org?.created_at ?? null,
    updatedAt: entry.org?.updated_at ?? null,
  };
};

const mapTeam = (team) => ({
  id: team.team_id,
  name: safeString(team.name, 'Team'),
  description: safeString(team.description, ''),
  memberIds: normalizeStringList(team.member_ids),
  source: 'stara',
  createdAt: team.created_at ?? null,
  updatedAt: team.updated_at ?? null,
});

const mapMember = ({ member, activeEntry, roleMap, teams }) => {
  const roleKey = normalizeRoleKey(member.role_key);
  return {
    userId: member.user_id,
    email: normalizeEmail(member.email),
    name: safeString(member.display_name ?? member.email, 'Member'),
    tenantId: member.tenant_id,
    orgName: safeString(activeEntry.org?.name, member.tenant_id),
    roleKey,
    roleLabel: roleMap.get(roleKey)?.label ?? roleKey,
    status: member.status === 'active' ? 'active' : 'disabled',
    isDefault: member.user_id === activeEntry.membership?.user_id,
    scopeIds: normalizeStringList(member.scope_ids),
    groupIds: teams
      .filter((team) => team.memberIds.includes(member.user_id))
      .map((team) => team.id),
    createdAt: member.joined_at ?? null,
    updatedAt: member.updated_at ?? null,
  };
};

const mapInvite = (invite, roleMap) => {
  const roleKey = normalizeRoleKey(invite.role_key);
  return {
    id: invite.invite_id,
    tenantId: invite.tenant_id,
    email: normalizeEmail(invite.email),
    roleKey,
    roleLabel: roleMap.get(roleKey)?.label ?? roleKey,
    scopeIds: normalizeStringList(invite.scope_ids),
    groupIds: [],
    status: invite.status === 'accepted' ? 'consumed' : invite.status,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at,
  };
};

const buildOrganizationsContext = async (inputUser) => {
  const user = await loadStaraUser(inputUser);
  const accessOptions = await callStaraApi(user, '/v1/orgs/access-options');
  const roles = roleCatalog(accessOptions);
  const roleMap = roleMapFrom(roles);
  const response = await callStaraApi(user, '/v1/orgs');
  const entries = (response.orgs ?? []).filter(
    (entry) => entry?.org?.tenant_id && entry?.membership?.status === 'active',
  );
  const canonicalActiveTenantId = safeString(response.active_tenant_id);
  const activeEntry =
    entries.find((entry) => entry.org.tenant_id === canonicalActiveTenantId) ?? null;
  const activeTenantId = activeEntry?.org?.tenant_id ?? null;
  await setCompatibilityTenant(user, activeTenantId);

  let teams = [];
  let members = [];
  let invites = [];
  let canManage = false;
  if (activeEntry) {
    const activeRole = roleMap.get(normalizeRoleKey(activeEntry.membership.role_key));
    canManage = Boolean(activeRole?.canManageOrg);
    const memberResponse = await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(activeTenantId)}/members`,
      { tenantId: activeTenantId },
    );
    const teamResponse = await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(activeTenantId)}/teams`,
      { tenantId: activeTenantId },
    );
    teams = (teamResponse.teams ?? []).map(mapTeam);
    members = (memberResponse.members ?? []).map((member) =>
      mapMember({ member, activeEntry, roleMap, teams }),
    );
    if (canManage) {
      const inviteResponse = await callStaraApi(
        user,
        `/v1/orgs/${encodeURIComponent(activeTenantId)}/invites`,
        { tenantId: activeTenantId },
      );
      invites = (inviteResponse.invites ?? [])
        .filter((invite) => invite.status === 'pending')
        .map((invite) => mapInvite(invite, roleMap));
    }
  }

  const orgs = entries.map((entry) => mapOrg(entry, roleMap, activeTenantId));
  const activeOrg = orgs.find((org) => org.tenantId === activeTenantId) ?? null;
  const activeMember = members.find((member) => member.isDefault) ?? null;
  const groupIds = activeMember?.groupIds ?? [];
  const scopeIds = activeMember?.scopeIds ?? [];

  return {
    activeOrg,
    orgs,
    members,
    invites,
    teams,
    roleBundles: roles,
    scopeOptions: (accessOptions.scope_options ?? []).map((scope) => ({
      id: scope.id,
      label: safeString(scope.label, scope.id),
      description: safeString(scope.description, scope.id),
    })),
    scopedAccess: {
      tenantId: activeTenantId,
      scopeIds,
      groupIds,
      restrictedAreas:
        activeEntry && scopeIds.length === 0 && groupIds.length === 0
          ? ['No optional Stara surface scopes are assigned.']
          : [],
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

const publicAppUrl = () =>
  (process.env.APP_PUBLIC_URL || process.env.DOMAIN_CLIENT || '').replace(/\/+$/, '');

const buildInviteLink = (rawToken) => {
  const path = `/organizations/invite?token=${encodeURIComponent(rawToken)}`;
  return publicAppUrl() ? `${publicAppUrl()}${path}` : path;
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const sendInviteEmail = async ({ email, orgName, inviterName, inviteLink }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return { sent: false, reason: 'resend_not_configured' };
  }
  const safeInviter = escapeHtml(inviterName || 'Someone');
  const safeOrg = escapeHtml(orgName);
  const safeLink = escapeHtml(inviteLink);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${inviterName || 'Someone'} invited you to ${orgName} on Stara`,
      html: [
        `<p>${safeInviter} invited you to join ${safeOrg} on Stara.</p>`,
        `<p><a href="${safeLink}">Accept your invite</a></p>`,
        '<p>This invite expires in 7 days.</p>',
      ].join(''),
    }),
  });
  if (!response.ok) {
    const error = new Error(`Invite email delivery failed with status ${response.status}`);
    error.status = 502;
    throw error;
  }
  return { sent: true };
};

const respondWithError = (res, label, error) => {
  logger.error(`[StaraOrganizations] ${label}`, error);
  return res.status(error.status ?? 500).json({
    message: safeString(error.message, 'Something went wrong.', 300),
  });
};

const getOrganizationsContextController = async (req, res) => {
  try {
    return res.status(200).json(await buildOrganizationsContext(req.user));
  } catch (error) {
    return respondWithError(res, 'Failed to load context', error);
  }
};

const createOrganizationController = async (req, res) => {
  try {
    const name = safeString(req.body?.name, undefined, MAX_NAME_LENGTH);
    if (!name || name.length < 2) {
      return res.status(400).json({ message: 'Org name must be at least 2 characters' });
    }
    const user = await loadStaraUser(req.user);
    const created = await callStaraApi(user, '/v1/orgs', {
      method: 'POST',
      body: { name },
    });
    const tenantId = created.org.tenant_id;
    const activated = await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(tenantId)}/activate`,
      {
        method: 'POST',
        tenantId,
      },
    );
    await setCompatibilityTenant(user, activated.active_tenant_id);
    return res.status(201).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to create org', error);
  }
};

const activateOrganizationController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const user = await loadStaraUser(req.user);
    const activated = await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(tenantId)}/activate`,
      {
        method: 'POST',
        tenantId,
      },
    );
    await setCompatibilityTenant(user, activated.active_tenant_id);
    return res.status(200).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to activate org', error);
  }
};

const listMembersController = async (req, res) => {
  try {
    const context = await buildOrganizationsContext(req.user);
    return res.status(200).json(context.members);
  } catch (error) {
    return respondWithError(res, 'Failed to list members', error);
  }
};

const updateMemberController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const userId = safeString(req.params.userId);
    const user = await loadStaraUser(req.user);
    const body = {};
    if (req.body?.roleKey !== undefined) {
      body.role_key = normalizeRoleKey(req.body.roleKey);
    }
    if (req.body?.scopeIds !== undefined) {
      body.scope_ids = normalizeStringList(req.body.scopeIds);
    }
    if (req.body?.status !== undefined) {
      body.status = req.body.status === 'active' ? 'active' : 'disabled';
    }
    await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', tenantId, body },
    );
    return res.status(200).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to update member', error);
  }
};

const disableMemberController = async (req, res) => {
  req.body = { ...(req.body ?? {}), status: 'disabled' };
  return updateMemberController(req, res);
};

const createInviteController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'A valid email is required' });
    }
    const user = await loadStaraUser(req.user);
    const response = await callStaraApi(user, `/v1/orgs/${encodeURIComponent(tenantId)}/invites`, {
      method: 'POST',
      tenantId,
      body: {
        email,
        role_key: normalizeRoleKey(req.body?.roleKey),
        scope_ids: normalizeStringList(req.body?.scopeIds),
        expires_in_days: 7,
      },
    });
    const context = await buildOrganizationsContext(user);
    const orgName = context.orgs.find((org) => org.tenantId === tenantId)?.name ?? tenantId;
    const inviteLink = buildInviteLink(response.token);
    let delivery;
    try {
      delivery = await sendInviteEmail({
        email,
        orgName,
        inviterName: safeString(user.name ?? user.username ?? user.email, 'A Stara user'),
        inviteLink,
      });
    } catch (error) {
      logger.warn('[StaraOrganizations] Invite email delivery failed', {
        status: error.status ?? 502,
      });
      delivery = { sent: false, reason: 'resend_failed' };
    }
    const roles = roleMapFrom(context.roleBundles);
    return res.status(201).json({
      invite: mapInvite(response.invite, roles),
      delivery,
      inviteLink: delivery.sent ? undefined : inviteLink,
      context,
    });
  } catch (error) {
    return respondWithError(res, 'Failed to create invite', error);
  }
};

const acceptInviteController = async (req, res) => {
  try {
    const token = safeString(req.body?.token, undefined, 2048);
    if (!token) {
      return res.status(400).json({ message: 'Invite token is required' });
    }
    const user = await loadStaraUser(req.user);
    const accepted = await callStaraApi(user, '/v1/orgs/invites/accept', {
      method: 'POST',
      body: { token },
    });
    await setCompatibilityTenant(user, accepted.active_tenant_id);
    return res.status(200).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to accept invite', error);
  }
};

const revokeInviteController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const inviteId = safeString(req.params.inviteId);
    const user = await loadStaraUser(req.user);
    await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(tenantId)}/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE', tenantId },
    );
    return res.status(200).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to revoke invite', error);
  }
};

const createTeamController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const name = safeString(req.body?.name, undefined, MAX_NAME_LENGTH);
    if (!name) {
      return res.status(400).json({ message: 'Team name is required' });
    }
    const user = await loadStaraUser(req.user);
    await callStaraApi(user, `/v1/orgs/${encodeURIComponent(tenantId)}/teams`, {
      method: 'POST',
      tenantId,
      body: {
        name,
        description: safeString(req.body?.description, ''),
        member_ids: normalizeStringList(req.body?.memberIds),
      },
    });
    return res.status(201).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to create team', error);
  }
};

const updateTeamController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const teamId = safeString(req.params.teamId);
    const user = await loadStaraUser(req.user);
    const body = {};
    if (req.body?.name !== undefined) {
      body.name = safeString(req.body.name, undefined, MAX_NAME_LENGTH);
    }
    if (req.body?.description !== undefined) {
      body.description = safeString(req.body.description, '');
    }
    if (req.body?.memberIds !== undefined) {
      body.member_ids = normalizeStringList(req.body.memberIds);
    }
    await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(tenantId)}/teams/${encodeURIComponent(teamId)}`,
      { method: 'PATCH', tenantId, body },
    );
    return res.status(200).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to update team', error);
  }
};

const deleteTeamController = async (req, res) => {
  try {
    const tenantId = safeString(req.params.tenantId);
    const teamId = safeString(req.params.teamId);
    const user = await loadStaraUser(req.user);
    await callStaraApi(
      user,
      `/v1/orgs/${encodeURIComponent(tenantId)}/teams/${encodeURIComponent(teamId)}`,
      { method: 'DELETE', tenantId },
    );
    return res.status(200).json(await buildOrganizationsContext(user));
  } catch (error) {
    return respondWithError(res, 'Failed to delete team', error);
  }
};

module.exports = {
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
