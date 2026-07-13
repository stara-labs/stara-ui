const {
  AccessRoleIds,
  PermissionBits,
  PrincipalType,
  ResourceType,
} = require('librechat-data-provider');
const { canonicalAgentId, canonicalAgentsEnabled } = require('~/models/canonicalAgents');
const { callStaraApi, safeString } = require('~/server/services/StaraServiceClient');

const ROLE_IDS = {
  viewer: AccessRoleIds.AGENT_VIEWER,
  operator: AccessRoleIds.AGENT_OPERATOR,
  editor: AccessRoleIds.AGENT_EDITOR,
  owner: AccessRoleIds.AGENT_OWNER,
};
const ROLE_KEYS = Object.fromEntries(Object.entries(ROLE_IDS).map(([key, value]) => [value, key]));

const isCanonicalAgentSharing = (resourceType) =>
  canonicalAgentsEnabled() && resourceType === ResourceType.AGENT;

const request = (user, path, options = {}) =>
  callStaraApi(user, path, { ...options, tenantId: user.tenantId });

const getCanonicalAgentRoles = async (user) => {
  const response = await request(user, '/v1/access/roles?resource_type=agent');
  return (response.roles ?? []).map((role) => ({
    accessRoleId: requireRoleId(role.role_key),
    name: safeString(role.label, role.role_key, 100),
    description: safeString(role.label, undefined, 300),
    permBits: permissionBits(role.permissions),
  }));
};

const getCanonicalAgentPermissions = async (user, resourceId) =>
  permissionsResponse(await loadSharingContext(user, resourceId));

const updateCanonicalAgentPermissions = async (user, resourceId, input = {}) => {
  const context = await loadSharingContext(user, resourceId);
  if (input.public === true || input.publicAccessRoleId) {
    const error = new Error(
      'Public agent sharing is not supported; grant access to organization members or teams.',
    );
    error.status = 400;
    throw error;
  }

  const desired = new Map(
    context.grants.map((grant) => [principalKey(grant.principal_type, grant.principal_id), grant]),
  );
  for (const principal of Array.isArray(input.removed) ? input.removed : []) {
    const normalized = normalizePrincipal(principal);
    rejectCanonicalOwner(context.agent, normalized);
    desired.delete(principalKey(normalized.principal_type, normalized.principal_id));
  }
  for (const principal of Array.isArray(input.updated) ? input.updated : []) {
    const normalized = normalizePrincipal(principal);
    rejectCanonicalOwner(context.agent, normalized);
    desired.set(principalKey(normalized.principal_type, normalized.principal_id), normalized);
  }

  const response = await request(
    user,
    `/v1/agents/${encodeURIComponent(context.agent.id)}/grants`,
    {
      method: 'PUT',
      body: {
        grants: [...desired.values()].map((grant) => ({
          principal_type: grant.principal_type,
          principal_id: grant.principal_id,
          role_key: grant.role_key,
        })),
      },
    },
  );

  return {
    message: 'Permissions updated successfully',
    results: {
      principals: mapGrantPrincipals(response.grants ?? [], context.members, context.teams),
      public: false,
    },
  };
};

const searchCanonicalPrincipals = async (user, { query, limit, typeFilters }) => {
  const me = await request(user, '/v1/me');
  const membership = selectActiveMembership(me.memberships, user?.tenantId);
  if (!membership) {
    return searchResponse(query, limit, typeFilters, []);
  }
  const tenantId = membership.tenant_id ?? membership.tenant_key;
  const [membersResponse, teamsResponse] = await Promise.all([
    request(user, `/v1/orgs/${encodeURIComponent(tenantId)}/members`),
    request(user, `/v1/orgs/${encodeURIComponent(tenantId)}/teams`),
  ]);
  const includeUsers = !typeFilters || typeFilters.includes(PrincipalType.USER);
  const includeGroups = !typeFilters || typeFilters.includes(PrincipalType.GROUP);
  const candidates = [
    ...(includeUsers ? (membersResponse.members ?? []).map(mapMemberPrincipal) : []),
    ...(includeGroups ? (teamsResponse.teams ?? []).map(mapTeamPrincipal) : []),
  ];
  const normalizedQuery = query.toLocaleLowerCase();
  const results = candidates
    .filter((principal) =>
      [principal.name, principal.email, principal.description]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, limit);
  return searchResponse(query, limit, typeFilters, results);
};

const loadSharingContext = async (user, resourceId) => {
  const agentId = canonicalAgentId(resourceId);
  if (!agentId) {
    const error = new Error('A canonical agent UUID is required.');
    error.status = 400;
    throw error;
  }
  const [agentResponse, grantsResponse] = await Promise.all([
    request(user, `/v1/agents/${encodeURIComponent(agentId)}`),
    request(user, `/v1/agents/${encodeURIComponent(agentId)}/grants`),
  ]);
  const agent = agentResponse.agent;
  const [membersResponse, teamsResponse] = await Promise.all([
    request(user, `/v1/orgs/${encodeURIComponent(agent.tenant_id)}/members`),
    request(user, `/v1/orgs/${encodeURIComponent(agent.tenant_id)}/teams`),
  ]);
  return {
    agent,
    grants: grantsResponse.grants ?? [],
    members: membersResponse.members ?? [],
    teams: teamsResponse.teams ?? [],
  };
};

const permissionsResponse = (context) => {
  const members = new Map(context.members.map((member) => [member.user_id, member]));
  const owner = members.get(context.agent.owner_user_id);
  return {
    resourceType: ResourceType.AGENT,
    resourceId: context.agent.id,
    principals: [
      {
        ...mapMemberPrincipal(
          owner ?? { user_id: context.agent.owner_user_id, display_name: 'Agent owner' },
        ),
        accessRoleId: AccessRoleIds.AGENT_OWNER,
        isCanonicalOwner: true,
      },
      ...mapGrantPrincipals(
        context.grants.filter(
          (grant) =>
            !(
              grant.principal_type === 'user' && grant.principal_id === context.agent.owner_user_id
            ),
        ),
        context.members,
        context.teams,
      ),
    ],
    public: false,
    publicSupported: false,
  };
};

const mapGrantPrincipals = (grants, members, teams) => {
  const memberMap = new Map(members.map((member) => [member.user_id, member]));
  const teamMap = new Map(teams.map((team) => [team.team_id, team]));
  return grants.flatMap((grant) => {
    if (grant.principal_type === 'user') {
      const member = memberMap.get(grant.principal_id);
      return member
        ? [{ ...mapMemberPrincipal(member), accessRoleId: requireRoleId(grant.role_key) }]
        : [];
    }
    if (grant.principal_type === 'team') {
      const team = teamMap.get(grant.principal_id);
      return team
        ? [{ ...mapTeamPrincipal(team), accessRoleId: requireRoleId(grant.role_key) }]
        : [];
    }
    return [];
  });
};

const mapMemberPrincipal = (member) => ({
  type: PrincipalType.USER,
  id: member.user_id,
  idOnTheSource: member.user_id,
  name: safeString(member.display_name ?? member.email, 'Organization member', 200),
  email: safeString(member.email, undefined, 320),
  source: 'local',
});

const mapTeamPrincipal = (team) => ({
  type: PrincipalType.GROUP,
  id: team.team_id,
  idOnTheSource: team.team_id,
  name: safeString(team.name, 'Team', 200),
  description: safeString(team.description, undefined, 500),
  memberCount: Array.isArray(team.member_ids) ? team.member_ids.length : 0,
  source: 'local',
});

const normalizePrincipal = (principal) => {
  let principalType = null;
  if (principal?.type === PrincipalType.USER) {
    principalType = 'user';
  } else if (principal?.type === PrincipalType.GROUP) {
    principalType = 'team';
  }
  const principalId = safeString(principal?.id ?? principal?.idOnTheSource);
  const roleKey = ROLE_KEYS[principal?.accessRoleId];
  if (!principalType || !principalId || !roleKey) {
    const error = new Error(
      'Canonical agent grants require a member or team and a valid Stara role.',
    );
    error.status = 400;
    throw error;
  }
  return { principal_type: principalType, principal_id: principalId, role_key: roleKey };
};

const rejectCanonicalOwner = (agent, principal) => {
  if (principal.principal_type === 'user' && principal.principal_id === agent.owner_user_id) {
    const error = new Error('The canonical agent owner cannot be removed or reassigned.');
    error.status = 400;
    throw error;
  }
};

const requireRoleId = (roleKey) => {
  const roleId = ROLE_IDS[roleKey];
  if (!roleId) {
    throw new Error(`Unsupported canonical agent role: ${roleKey}`);
  }
  return roleId;
};

const permissionBits = (permissions) => {
  const values = new Set(Array.isArray(permissions) ? permissions : []);
  return (
    (values.has('agent.read') ? PermissionBits.VIEW : 0) |
    (values.has('agent.edit') ? PermissionBits.EDIT : 0) |
    (values.has('agent.delete') ? PermissionBits.DELETE : 0) |
    (values.has('agent.share') ? PermissionBits.SHARE : 0)
  );
};

const principalKey = (type, id) => `${type}:${id}`;

const selectActiveMembership = (memberships = [], activeTenantId) =>
  memberships.find(
    (membership) =>
      membership.membership_status === 'active' &&
      (membership.tenant_id === activeTenantId || membership.tenant_key === activeTenantId),
  ) ?? memberships.find((membership) => membership.membership_status === 'active');

const searchResponse = (query, limit, types, results) => ({
  query,
  limit,
  types,
  results,
  count: results.length,
  sources: { local: results.length, entra: 0 },
});

module.exports = {
  getCanonicalAgentPermissions,
  getCanonicalAgentRoles,
  isCanonicalAgentSharing,
  searchCanonicalPrincipals,
  updateCanonicalAgentPermissions,
};
