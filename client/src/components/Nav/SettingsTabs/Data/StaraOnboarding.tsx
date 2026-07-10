import { useNavigate } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { Building2, ShieldCheck, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStaraOnboardingContextQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function StaraOnboardingSettings() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data, isLoading } = useStaraOnboardingContextQuery({
    staleTime: 1000 * 10,
  });

  let addendumStatus = localize('com_ui_stara_onboarding_status_not_applicable');
  if (data?.activeMembership) {
    addendumStatus = data.requiresTenantAddendum
      ? localize('com_ui_stara_onboarding_status_required')
      : localize('com_ui_stara_onboarding_status_complete');
  }

  const activeOrg =
    data?.activeMembership?.orgName ?? localize('com_ui_stara_onboarding_no_active_org');
  const accountStatus = data?.account.completed
    ? localize('com_ui_stara_onboarding_status_complete')
    : localize('com_ui_stara_onboarding_status_required');
  const scopedSummary = localize('com_ui_stara_onboarding_scoped_summary', {
    scopes: data?.access.scopes.length ?? 0,
    groups: data?.access.groups.length ?? 0,
    grants: data?.access.grants.length ?? 0,
  });

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{localize('com_ui_settings_label_stara_onboarding')}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            {localize('com_ui_stara_onboarding_settings_description')}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate('/onboarding?mode=review')}
          disabled={isLoading}
        >
          {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
          {localize('com_ui_stara_onboarding_run_again')}
        </Button>
      </div>

      <div className="grid gap-2 rounded-lg border border-border-light bg-surface-secondary p-3 text-xs text-text-secondary sm:grid-cols-2">
        <StatusLine
          icon={Sparkles}
          label={localize('com_ui_stara_onboarding_account')}
          value={accountStatus}
        />
        <StatusLine
          icon={Building2}
          label={localize('com_ui_stara_onboarding_active_org')}
          value={activeOrg}
        />
        <StatusLine
          icon={ShieldCheck}
          label={localize('com_ui_stara_onboarding_org_addendum')}
          value={addendumStatus}
        />
        <StatusLine
          icon={ShieldCheck}
          label={localize('com_ui_stara_onboarding_scoped_access')}
          value={scopedSummary}
        />
      </div>
    </div>
  );
}

function StatusLine({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium text-text-primary">{label}</div>
        <div className="truncate">{value}</div>
      </div>
    </div>
  );
}
