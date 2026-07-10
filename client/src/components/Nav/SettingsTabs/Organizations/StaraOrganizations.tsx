import { useState } from 'react';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import { Building2, Copy, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { StaraOrgRoleKey, TStaraOrgMember } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import {
  useActivateStaraOrganizationMutation,
  useCreateStaraOrganizationInviteMutation,
  useCreateStaraOrganizationMutation,
  useCreateStaraOrganizationTeamMutation,
  useDeleteStaraOrganizationTeamMutation,
  useDisableStaraOrganizationMemberMutation,
  useRevokeStaraOrganizationInviteMutation,
  useStaraOrganizationsContextQuery,
  useUpdateStaraOrganizationMemberMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function StaraOrganizationsSettings() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, refetch, isFetching } = useStaraOrganizationsContextQuery();
  const [orgName, setOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<StaraOrgRoleKey>('member');
  const [inviteScopeIds, setInviteScopeIds] = useState<string[]>([]);
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [fallbackLink, setFallbackLink] = useState('');

  const createOrg = useCreateStaraOrganizationMutation({
    onSuccess: () => {
      setOrgName('');
      showToast({ message: 'Org created' });
    },
    onError: () => showToast({ message: 'Could not create org', status: 'error' }),
  });
  const activateOrg = useActivateStaraOrganizationMutation();
  const createInvite = useCreateStaraOrganizationInviteMutation({
    onSuccess: (response) => {
      setInviteEmail('');
      setFallbackLink(response.inviteLink ?? '');
      showToast({
        message: response.delivery.sent
          ? 'Invite email sent'
          : 'Invite created. Copy the fallback link.',
      });
    },
    onError: () => showToast({ message: 'Could not create invite', status: 'error' }),
  });
  const revokeInvite = useRevokeStaraOrganizationInviteMutation();
  const updateMember = useUpdateStaraOrganizationMemberMutation({
    onError: () => showToast({ message: 'Could not update member', status: 'error' }),
  });
  const disableMember = useDisableStaraOrganizationMemberMutation({
    onError: () => showToast({ message: 'Could not disable member', status: 'error' }),
  });
  const createTeam = useCreateStaraOrganizationTeamMutation({
    onSuccess: () => {
      setTeamName('');
      setTeamDescription('');
      showToast({ message: 'Team created' });
    },
    onError: () => showToast({ message: 'Could not create team', status: 'error' }),
  });
  const deleteTeam = useDeleteStaraOrganizationTeamMutation();

  const activeTenantId = data?.activeOrg?.tenantId;
  const canManage = Boolean(data?.permissions.canManageMembers);
  const roleOptions = data?.roleBundles ?? [];
  const scopes = data?.scopeOptions ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="h-4 w-4" />
        <span>Loading organizations...</span>
      </div>
    );
  }

  const copyFallbackLink = async () => {
    if (!fallbackLink) {
      return;
    }
    await navigator.clipboard.writeText(fallbackLink);
    showToast({ message: 'Invite link copied' });
  };

  const toggleInviteScope = (scopeId: string) => {
    setInviteScopeIds((current) =>
      current.includes(scopeId)
        ? current.filter((existing) => existing !== scopeId)
        : [...current, scopeId],
    );
  };

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <Header
            icon={Building2}
            title="Organizations"
            description="Create orgs, switch active tenant access, and manage tenant-scoped teams and roles."
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {localize('com_ui_refresh')}
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <Input
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            placeholder="New org name"
          />
          <Button
            className="gap-2"
            onClick={() => createOrg.mutate({ name: orgName })}
            disabled={!orgName.trim() || createOrg.isLoading}
          >
            {createOrg.isLoading ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {localize('com_ui_stara_org_create')}
          </Button>
        </div>

        {data?.orgs.length ? (
          <div className="grid gap-2">
            {data.orgs.map((org) => (
              <div
                key={org.tenantId}
                className="flex items-center justify-between gap-3 rounded-md border border-border-light bg-surface-secondary p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text-primary">{org.name}</div>
                  <div className="text-xs text-text-secondary">
                    {org.roleLabel} {org.isDefault ? 'active' : 'available'}
                  </div>
                </div>
                <Button
                  variant={org.isDefault ? 'secondary' : 'outline'}
                  size="sm"
                  disabled={org.isDefault || activateOrg.isLoading}
                  onClick={() => activateOrg.mutate(org.tenantId)}
                >
                  {org.isDefault ? 'Active' : 'Switch'}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-secondary">{localize('com_ui_stara_org_empty')}</p>
        )}
      </section>

      {activeTenantId ? (
        <>
          <section className="grid gap-3">
            <Header
              icon={Users}
              title="Members and invites"
              description="Invite users by email, assign role bundles, and adjust scoped tenant access."
            />
            {canManage ? (
              <div className="grid gap-2 rounded-md border border-border-light p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
                  <Input
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="member@example.com"
                    type="email"
                  />
                  <select
                    className="rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as StaraOrgRoleKey)}
                  >
                    {roleOptions.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() =>
                      createInvite.mutate({
                        tenantId: activeTenantId,
                        payload: {
                          email: inviteEmail,
                          roleKey: inviteRole,
                          scopeIds: inviteScopeIds,
                        },
                      })
                    }
                    disabled={!inviteEmail.trim() || createInvite.isLoading}
                  >
                    {localize('com_ui_stara_org_send_invite')}
                  </Button>
                </div>
                <ScopePicker
                  scopeIds={inviteScopeIds}
                  scopes={scopes}
                  disabled={!canManage}
                  onToggle={toggleInviteScope}
                />
                {fallbackLink ? (
                  <div className="flex min-w-0 items-center gap-2 rounded-md bg-surface-secondary p-2 text-xs text-text-secondary">
                    <span className="truncate">{fallbackLink}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5"
                      onClick={copyFallbackLink}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {localize('com_ui_copy')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-text-secondary">
                {localize('com_ui_stara_org_read_only')}
              </p>
            )}

            <div className="grid gap-2">
              {data.members.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  canManage={canManage}
                  roleOptions={roleOptions}
                  scopes={scopes}
                  onRoleChange={(roleKey) =>
                    updateMember.mutate({
                      tenantId: activeTenantId,
                      userId: member.userId,
                      payload: { roleKey },
                    })
                  }
                  onScopeToggle={(scopeId) => {
                    const nextScopes = member.scopeIds.includes(scopeId)
                      ? member.scopeIds.filter((existing) => existing !== scopeId)
                      : [...member.scopeIds, scopeId];
                    updateMember.mutate({
                      tenantId: activeTenantId,
                      userId: member.userId,
                      payload: { scopeIds: nextScopes },
                    });
                  }}
                  onDisable={() =>
                    disableMember.mutate({ tenantId: activeTenantId, userId: member.userId })
                  }
                />
              ))}
            </div>

            {data.invites.length ? (
              <div className="grid gap-2">
                {data.invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border-light bg-surface-secondary p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {invite.email}
                      </div>
                      <div className="text-xs text-text-secondary">
                        {localize('com_ui_stara_org_pending_invite', { role: invite.roleLabel })}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        revokeInvite.mutate({ tenantId: activeTenantId, inviteId: invite.id })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {localize('com_ui_stara_org_revoke')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="grid gap-3">
            <Header
              icon={ShieldCheck}
              title="Teams and scoped access"
              description="Teams are local tenant groups; scopes describe which Stara surfaces a member can reach."
            />
            {canManage ? (
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  placeholder="Team name"
                />
                <Input
                  value={teamDescription}
                  onChange={(event) => setTeamDescription(event.target.value)}
                  placeholder="Description"
                />
                <Button
                  className="gap-2"
                  disabled={!teamName.trim() || createTeam.isLoading}
                  onClick={() =>
                    createTeam.mutate({
                      tenantId: activeTenantId,
                      payload: { name: teamName, description: teamDescription },
                    })
                  }
                >
                  <Plus className="h-4 w-4" />
                  {localize('com_ui_stara_org_create_team')}
                </Button>
              </div>
            ) : null}
            <div className="grid gap-2">
              {data.teams.map((team) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-light bg-surface-secondary p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {team.name}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {localize('com_ui_stara_org_team_summary', {
                        description:
                          team.description || localize('com_ui_stara_org_no_description'),
                        count: team.memberIds.length,
                      })}
                    </div>
                  </div>
                  {canManage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        deleteTeam.mutate({ tenantId: activeTenantId, teamId: team.id })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {localize('com_ui_delete')}
                    </Button>
                  ) : null}
                </div>
              ))}
              {!data.teams.length ? (
                <p className="text-xs text-text-secondary">
                  {localize('com_ui_stara_org_no_teams')}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2 rounded-md border border-border-light bg-surface-secondary p-3 text-xs text-text-secondary sm:grid-cols-2">
              {scopes.map((scope) => (
                <div key={scope.id}>
                  <div className="font-medium text-text-primary">{scope.label}</div>
                  <div>{scope.description}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Header({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-text-secondary">{description}</p>
    </div>
  );
}

function ScopePicker({
  scopeIds,
  scopes,
  disabled,
  onToggle,
}: {
  scopeIds: string[];
  scopes: Array<{ id: string; label: string }>;
  disabled: boolean;
  onToggle: (scopeId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {scopes.map((scope) => (
        <label
          key={scope.id}
          className="flex items-center gap-1.5 rounded-md border border-border-light px-2 py-1 text-xs text-text-secondary"
        >
          <input
            type="checkbox"
            checked={scopeIds.includes(scope.id)}
            disabled={disabled}
            onChange={() => onToggle(scope.id)}
          />
          {scope.label}
        </label>
      ))}
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  roleOptions,
  scopes,
  onRoleChange,
  onScopeToggle,
  onDisable,
}: {
  member: TStaraOrgMember;
  canManage: boolean;
  roleOptions: Array<{ key: StaraOrgRoleKey; label: string }>;
  scopes: Array<{ id: string; label: string }>;
  onRoleChange: (roleKey: StaraOrgRoleKey) => void;
  onScopeToggle: (scopeId: string) => void;
  onDisable: () => void;
}) {
  const localize = useLocalize();
  return (
    <div className="grid gap-3 rounded-md border border-border-light bg-surface-secondary p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text-primary">{member.name}</div>
          <div className="truncate text-xs text-text-secondary">
            {member.email || member.userId} · {member.status}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            className="rounded-md border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary"
            value={member.roleKey}
            disabled={!canManage}
            onChange={(event) => onRoleChange(event.target.value as StaraOrgRoleKey)}
          >
            {roleOptions.map((role) => (
              <option key={role.key} value={role.key}>
                {role.label}
              </option>
            ))}
          </select>
          {canManage ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onDisable}>
              <Trash2 className="h-3.5 w-3.5" />
              {localize('com_ui_stara_org_disable')}
            </Button>
          ) : null}
        </div>
      </div>
      <ScopePicker
        scopeIds={member.scopeIds}
        scopes={scopes}
        disabled={!canManage}
        onToggle={onScopeToggle}
      />
    </div>
  );
}
