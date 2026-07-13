const {
  AccessRoleIds,
  PermissionBits,
  PrincipalType,
  ResourceType,
} = require('librechat-data-provider');
const { canonicalAgentId, canonicalAgentsEnabled } = require('~/models/canonicalAgents');
const { canonicalSkillId, canonicalSkillsEnabled } = require('~/models/canonicalSkills');
const { callStaraApi, safeString } = require('~/server/services/StaraServiceClient');

const RESOURCE_CONFIG = {
  [ResourceType.AGENT]: {
    enabled: canonicalAgentsEnabled,
    canonicalId: canonicalAgentId,
    apiCollection: 'agents',
    responseKey: 'agent',
    permissionPrefix: 'agent',
    roleIds: {
      viewer: AccessRoleIds.AGENT_VIEWER,
      operator: AccessRoleIds.AGENT_OPERATOR,
      editor: AccessRoleIds.AGENT_EDITOR,
      owner: AccessRoleIds.AGENT_OWNER,
    },
  },
  [ResourceType.SKILL]: {
    enabled: canonicalSkillsEnabled,
    canonicalId: canonicalSkillId,
    apiCollection: 'skills',
    responseKey: 'skill',
    permissionPrefix: 'skill',
    roleIds: {
      viewer: AccessRoleIds.SKILL_VIEWER,
      operator: AccessRoleIds.SKILL_OPERATOR,
      editor: AccessRoleIds.SKILL_EDITOR,
      owner: AccessRoleIds.SKILL_OWNER,
    },
  },
};

const isCanonicalResourceSharing = (resourceType) => {
  const config = RESOURCE_CONFIG[resourceType];
  return Boolean(config?.enabled());
};

const getCanonicalResourceRoles = async (user, resourceType) => {
  const config = requireConfig(resourceType);
  const response = await request(
    user,
    `/v1/access/roles?resource_type=${encodeURIComponent(resourceType)}`,
  );
  return (response.roles ?? []).map((role) => ({
    accessRoleId: requireRoleId(config, role.role_key),
    name: safeString(role.label, role.role_key, 100),
    description: safeString(role.label, undefined, 300),
    permBits: permissionBits(config, role.permissions),
  }));
};

const getCanonicalResourcePermissions = async (user, resourceType, resourceId) =>
  permissionsResponse(await loadSharingContext(user, resourceType, resourceId));

const updateCanonicalResourcePermissions = async (user, resourceType, resourceId, input = {}) => {
  const context = await loadSharingContext(user, resourceType, resourceId);
  if (input.public === true || input.publicAccessRoleId) {
    throw httpError(
      `Public ${resourceType} sharing is not supported; grant access to organization members or teams.`,
      400,
    );
  }
  const desired = new Map(
    context.grants.map((grant) => [principalKey(grant.principal_type, grant.principal_id), grant]),
  );
  for (const principal of Array.isArray(input.removed) ? input.removed : []) {
    const normalized = normalizePrincipal(context.config, principal);
    rejectCanonicalOwner(context.resource, resourceType, normalized);
    desired.delete(principalKey(normalized.principal_type, normalized.principal_id));
  }
  for (const principal of Array.isArray(input.updated) ? input.updated : []) {
    const normalized = normalizePrincipal(context.config, principal);
    rejectCanonicalOwner(context.resource, resourceType, normalized);
    desired.set(principalKey(normalized.principal_type, normalized.principal_id), normalized);
  }
  const response = await request(
    user,
    `/v1/${context.config.apiCollection}/${encodeURIComponent(context.resource.id)}/grants`,
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
      principals: mapGrantPrincipals(
        context.config,
        response.grants ?? [],
        context.members,
        context.teams,
      ),
      public: false,
    },
  };
};

const searchCanonicalPrincipals = async (user, { query, limit, typeFilters }) => {
  const me = await request(user, '/v1/me');
  const membership = selectActiveMembership(me.memberships, user?.tenantId);
  if (!membership) return searchResponse(query, limit, typeFilters, []);
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

const loadSharingContext = async (user, resourceType, resourceId) => {
  const config = requireConfig(resourceType);
  const id = config.canonicalId(resourceId);
  if (!id) throw httpError(`A canonical ${resourceType} UUID is required.`, 400);
  const [resourceResponse, grantsResponse] = await Promise.all([
    request(user, `/v1/${config.apiCollection}/${encodeURIComponent(id)}`),
    request(user, `/v1/${config.apiCollection}/${encodeURIComponent(id)}/grants`),
  ]);
  const resource = resourceResponse[config.responseKey];
  const [membersResponse, teamsResponse] = await Promise.all([
    request(user, `/v1/orgs/${encodeURIComponent(resource.tenant_id)}/members`),
    request(user, `/v1/orgs/${encodeURIComponent(resource.tenant_id)}/teams`),
  ]);
  return {
    config,
    resourceType,
    resource,
    grants: grantsResponse.grants ?? [],
    members: membersResponse.members ?? [],
    teams: teamsResponse.teams ?? [],
  };
};

const permissionsResponse = (context) => {
  const members = new Map(context.members.map((member) => [member.user_id, member]));
  const owner = members.get(context.resource.owner_user_id);
  return {
    resourceType: context.resourceType,
    resourceId: context.resource.id,
    principals: [
      {
        ...mapMemberPrincipal(
          owner ?? {
            user_id: context.resource.owner_user_id,
            display_name: `${titleCase(context.resourceType)} owner`,
          },
        ),
        accessRoleId: context.config.roleIds.owner,
        isCanonicalOwner: true,
      },
      ...mapGrantPrincipals(
        context.config,
        context.grants.filter(
          (grant) =>
            !(
              grant.principal_type === 'user' &&
              grant.principal_id === context.resource.owner_user_id
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

const mapGrantPrincipals = (config, grants, members, teams) => {
  const memberMap = new Map(members.map((member) => [member.user_id, member]));
  const teamMap = new Map(teams.map((team) => [team.team_id, team]));
  return grants.flatMap((grant) => {
    if (grant.principal_type === 'user') {
      const member = memberMap.get(grant.principal_id);
      return member
        ? [{ ...mapMemberPrincipal(member), accessRoleId: requireRoleId(config, grant.role_key) }]
        : [];
    }
    if (grant.principal_type === 'team') {
      const team = teamMap.get(grant.principal_id);
      return team
        ? [{ ...mapTeamPrincipal(team), accessRoleId: requireRoleId(config, grant.role_key) }]
        : [];
    }
    return [];
  });
};

const normalizePrincipal = (config, principal) => {
  const principalTypes = {
    [PrincipalType.USER]: 'user',
    [PrincipalType.GROUP]: 'team',
  };
  const principalType = principalTypes[principal?.type] ?? null;
  const principalId = safeString(principal?.id ?? principal?.idOnTheSource);
  const roleKeys = Object.fromEntries(
    Object.entries(config.roleIds).map(([roleKey, roleId]) => [roleId, roleKey]),
  );
  const roleKey = roleKeys[principal?.accessRoleId];
  if (!principalType || !principalId || !roleKey) {
    throw httpError(
      'Canonical grants require an organization member or team and a valid role.',
      400,
    );
  }
  return { principal_type: principalType, principal_id: principalId, role_key: roleKey };
};

const rejectCanonicalOwner = (resource, resourceType, principal) => {
  if (principal.principal_type === 'user' && principal.principal_id === resource.owner_user_id) {
    throw httpError(`The canonical ${resourceType} owner cannot be removed or reassigned.`, 400);
  }
};

const permissionBits = (config, permissions) => {
  const values = new Set(Array.isArray(permissions) ? permissions : []);
  const prefix = config.permissionPrefix;
  return (
    (values.has(`${prefix}.read`) ? PermissionBits.VIEW : 0) |
    (values.has(`${prefix}.edit`) ? PermissionBits.EDIT : 0) |
    (values.has(`${prefix}.delete`) ? PermissionBits.DELETE : 0) |
    (values.has(`${prefix}.share`) ? PermissionBits.SHARE : 0)
  );
};

const requireRoleId = (config, roleKey) => {
  const roleId = config.roleIds[roleKey];
  if (!roleId) throw new Error(`Unsupported canonical role: ${roleKey}`);
  return roleId;
};

const requireConfig = (resourceType) => {
  const config = RESOURCE_CONFIG[resourceType];
  if (!config?.enabled()) throw httpError(`Canonical ${resourceType} sharing is not enabled.`, 400);
  return config;
};

const request = (user, path, options = {}) =>
  callStaraApi(user, path, { ...options, tenantId: user.tenantId });
const principalKey = (type, id) => `${type}:${id}`;
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
const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const httpError = (message, status) => Object.assign(new Error(message), { status });

module.exports = {
  getCanonicalResourcePermissions,
  getCanonicalResourceRoles,
  isCanonicalResourceSharing,
  searchCanonicalPrincipals,
  updateCanonicalResourcePermissions,
};
