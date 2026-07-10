/* eslint-disable i18next/no-literal-string */
import { useMemo, useState } from 'react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import {
  AccessRoleIds,
  PermissionBits,
  PrincipalType,
  ResourceType,
} from 'librechat-data-provider';
import {
  Bot,
  Building2,
  Check,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  useGetResourcePermissionsQuery,
  useUpdateResourcePermissionsMutation,
} from 'librechat-data-provider/react-query';
import type { Agent, TPrincipal, TStaraOrgMember, TStaraOrgTeam } from 'librechat-data-provider';
import {
  useStaraOrganizationsContextQuery,
  useUpdateStaraOrganizationMemberMutation,
  useUpdateStaraOrganizationTeamMutation,
} from '~/data-provider';
import { useListAgentsQuery } from '~/data-provider/Agents';
import { cn } from '~/utils';

type OrgMember = TStaraOrgMember & {
  teamIds: string[];
};

const displayName = (member: TStaraOrgMember) => member.name || member.email || member.userId;

const isMemberOnTeam = (member: TStaraOrgMember, team: TStaraOrgTeam) =>
  member.groupIds.includes(team.id) || team.memberIds.includes(member.userId);

export default function StaraOrganizationControl() {
  const { showToast } = useToastContext();
  const orgQuery = useStaraOrganizationsContextQuery();
  const agentQuery = useListAgentsQuery(
    { limit: 100, requiredPermission: PermissionBits.SHARE },
    { staleTime: 1000 * 30 },
  );
  const updateMember = useUpdateStaraOrganizationMemberMutation({
    onError: () => showToast({ message: 'Could not update team assignment', status: 'error' }),
  });
  const updateTeam = useUpdateStaraOrganizationTeamMutation({
    onError: () => showToast({ message: 'Could not update org chart', status: 'error' }),
  });

  const data = orgQuery.data;
  const activeTenantId = data?.activeOrg?.tenantId;
  const canManageTeams = Boolean(data?.permissions.canManageTeams);

  const members = useMemo<OrgMember[]>(() => {
    const teams = data?.teams ?? [];
    return (data?.members ?? []).map((member) => ({
      ...member,
      teamIds: teams.filter((team) => isMemberOnTeam(member, team)).map((team) => team.id),
    }));
  }, [data?.members, data?.teams]);

  const unassignedMembers = members.filter((member) => member.teamIds.length === 0);
  const agents = agentQuery.data?.data ?? [];

  const assignMemberToTeam = async (member: OrgMember, team: TStaraOrgTeam) => {
    if (!activeTenantId || !canManageTeams) {
      return;
    }
    const isAssigned = member.teamIds.includes(team.id);
    const nextGroupIds = isAssigned
      ? member.groupIds.filter((groupId) => groupId !== team.id)
      : [...new Set([...member.groupIds, team.id])];
    const nextMemberIds = isAssigned
      ? team.memberIds.filter((memberId) => memberId !== member.userId)
      : [...new Set([...team.memberIds, member.userId])];

    await updateMember.mutateAsync({
      tenantId: activeTenantId,
      userId: member.userId,
      payload: { groupIds: nextGroupIds },
    });
    await updateTeam.mutateAsync({
      tenantId: activeTenantId,
      teamId: team.id,
      payload: { memberIds: nextMemberIds },
    });
    showToast({ message: isAssigned ? 'Member removed from team' : 'Member assigned to team' });
  };

  if (orgQuery.isLoading) {
    return <LoadingPanel label="Loading org control plane..." />;
  }

  if (!data?.activeOrg) {
    return (
      <EmptyState
        title="No active org"
        body="Create or activate an org in Settings, Organizations, then return here to build the org chart and assign agents."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-lg border border-border-light bg-surface-secondary p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-text-secondary">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Active org
            </div>
            <h2 className="mt-1 truncate text-xl font-semibold text-text-primary">
              {data.activeOrg.name}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {members.length} members / {data.teams.length} teams / {agents.length} assignable
              agents
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={orgQuery.isFetching || agentQuery.isFetching}
            onClick={() => {
              orgQuery.refetch();
              agentQuery.refetch();
            }}
          >
            {orgQuery.isFetching || agentQuery.isFetching ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Role" value={data.activeOrg.roleLabel} />
          <Metric label="Scoped areas" value={`${data.scopedAccess.scopeIds.length || 'All'}`} />
          <Metric label="Admin mode" value={canManageTeams ? 'Enabled' : 'Read only'} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <OrgChart
          teams={data.teams}
          members={members}
          unassignedMembers={unassignedMembers}
          canManage={canManageTeams}
          isSaving={updateMember.isLoading || updateTeam.isLoading}
          onToggleMember={assignMemberToTeam}
        />
        <AgentAssignment teams={data.teams} agents={agents} loading={agentQuery.isLoading} />
      </section>
    </div>
  );
}

function OrgChart({
  teams,
  members,
  unassignedMembers,
  canManage,
  isSaving,
  onToggleMember,
}: {
  teams: TStaraOrgTeam[];
  members: OrgMember[];
  unassignedMembers: OrgMember[];
  canManage: boolean;
  isSaving: boolean;
  onToggleMember: (member: OrgMember, team: TStaraOrgTeam) => void;
}) {
  return (
    <section className="rounded-lg border border-border-light bg-surface-secondary p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-text-secondary">
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            Org chart
          </div>
          <h2 className="mt-1 text-base font-semibold text-text-primary">Teams and members</h2>
        </div>
        {isSaving ? <Spinner className="h-4 w-4 text-text-secondary" /> : null}
      </div>

      <div className="grid gap-3">
        {teams.map((team) => {
          const teamMembers = members.filter((member) => member.teamIds.includes(team.id));
          return (
            <div key={team.id} className="rounded-lg border border-border-light bg-surface-primary">
              <div className="border-b border-border-light px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-text-primary">
                      {team.name}
                    </h3>
                    <p className="mt-1 truncate text-xs text-text-secondary">
                      {team.description || 'Local tenant team'}
                    </p>
                  </div>
                  <span className="rounded-md bg-surface-active-alt px-2 py-1 text-xs font-medium text-text-primary">
                    {teamMembers.length}
                  </span>
                </div>
              </div>
              <div className="grid gap-2 p-3">
                {teamMembers.map((member) => (
                  <MemberChip key={member.userId} member={member} />
                ))}
                {!teamMembers.length ? (
                  <p className="rounded-md border border-dashed border-border-light px-3 py-2 text-xs text-text-secondary">
                    No members assigned
                  </p>
                ) : null}
                {canManage ? (
                  <details className="rounded-md border border-border-light bg-surface-secondary">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-primary">
                      Assign members
                    </summary>
                    <div className="grid gap-1 border-t border-border-light p-2">
                      {members.map((member) => {
                        const checked = member.teamIds.includes(team.id);
                        return (
                          <label
                            key={member.userId}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleMember(member, team)}
                            />
                            <span className="min-w-0 flex-1 truncate">{displayName(member)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          );
        })}

        <div className="rounded-lg border border-border-light bg-surface-primary p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-text-secondary">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Unassigned
          </div>
          <div className="grid gap-2">
            {unassignedMembers.map((member) => (
              <MemberChip key={member.userId} member={member} />
            ))}
            {!unassignedMembers.length ? (
              <p className="text-xs text-text-secondary">Every active member is on a team.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentAssignment({
  teams,
  agents,
  loading,
}: {
  teams: TStaraOrgTeam[];
  agents: Agent[];
  loading: boolean;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const selectedResourceId = selectedAgent?._id ?? '';

  const permissionsQuery = useGetResourcePermissionsQuery(ResourceType.AGENT, selectedResourceId, {
    enabled: Boolean(selectedResourceId),
  });
  const updatePermissions = useUpdateResourcePermissionsMutation();
  const { showToast } = useToastContext();

  const shares = permissionsQuery.data?.principals ?? [];
  const assignedTeamIds = new Set(
    shares
      .filter((share) => share.type === PrincipalType.GROUP)
      .map((share) => share.id ?? share.idOnTheSource)
      .filter(Boolean),
  );

  const toggleTeamAgentAccess = async (team: TStaraOrgTeam) => {
    if (!selectedResourceId || updatePermissions.isLoading) {
      return;
    }
    const principal: TPrincipal = {
      type: PrincipalType.GROUP,
      id: team.id,
      idOnTheSource: team.id,
      name: team.name,
      source: team.source,
      description: team.description,
      accessRoleId: AccessRoleIds.AGENT_VIEWER,
    };
    const isAssigned = assignedTeamIds.has(team.id);
    await updatePermissions.mutateAsync({
      resourceType: ResourceType.AGENT,
      resourceId: selectedResourceId,
      data: {
        updated: isAssigned ? [] : [principal],
        removed: isAssigned ? [principal] : [],
      },
    });
    showToast({ message: isAssigned ? 'Agent unassigned from team' : 'Agent assigned to team' });
  };

  if (loading) {
    return <LoadingPanel label="Loading assignable agents..." />;
  }

  return (
    <section className="rounded-lg border border-border-light bg-surface-secondary p-4">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-text-secondary">
          <Bot className="h-4 w-4" aria-hidden="true" />
          Agent assignment
        </div>
        <h2 className="mt-1 text-base font-semibold text-text-primary">Grant teams agent access</h2>
        <p className="mt-1 text-sm leading-6 text-text-secondary">
          Assignments write to the existing agent ACL as team viewer grants.
        </p>
      </div>

      {agents.length ? (
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-medium text-text-secondary">
            Agent
            <select
              className="h-10 rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary"
              value={selectedAgent?.id ?? ''}
              onChange={(event) => setSelectedAgentId(event.target.value)}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name || agent.id}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2">
            {teams.map((team) => {
              const checked = assignedTeamIds.has(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                    checked
                      ? 'border-green-500/40 bg-green-500/10'
                      : 'border-border-light bg-surface-primary hover:bg-surface-hover',
                  )}
                  disabled={permissionsQuery.isLoading || updatePermissions.isLoading}
                  onClick={() => toggleTeamAgentAccess(team)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {team.name}
                    </span>
                    <span className="block truncate text-xs text-text-secondary">
                      {team.memberIds.length} members
                    </span>
                  </span>
                  {checked ? (
                    <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-300" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-text-secondary" />
                  )}
                </button>
              );
            })}
            {!teams.length ? (
              <p className="rounded-md border border-dashed border-border-light px-3 py-2 text-xs text-text-secondary">
                Create teams in Settings, Organizations before assigning agents.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No shareable agents"
          body="Create an agent or open an agent you own, then return here once you have share access."
        />
      )}
    </section>
  );
}

function MemberChip({ member }: { member: OrgMember }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border-light bg-surface-secondary px-3 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-active-alt text-xs font-semibold text-text-primary">
        {displayName(member).slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {displayName(member)}
        </span>
        <span className="block truncate text-xs text-text-secondary">
          {member.roleLabel} / {member.status}
        </span>
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-primary p-3">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-light bg-surface-secondary p-4 text-sm text-text-secondary">
      <Spinner className="h-4 w-4" />
      {label}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-light bg-surface-secondary p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Users className="h-4 w-4" aria-hidden="true" />
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{body}</p>
    </div>
  );
}
