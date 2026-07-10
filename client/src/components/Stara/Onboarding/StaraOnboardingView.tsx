import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Spinner, useMediaQuery, useToastContext } from '@librechat/client';
import {
  ArrowRight,
  Building2,
  Check,
  ChevronsRight,
  ClipboardCheck,
  LockKeyhole,
  Map,
  Network,
  Route,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { TStaraOnboardingContext, TStaraTenantMembership } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  useAcceptStaraTenantInviteMutation,
  useActivateStaraTenantMutation,
  useSaveStaraOnboardingMutation,
  useStaraOnboardingContextQuery,
} from '~/data-provider';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { cn } from '~/utils';

type Phase =
  | 'intent'
  | 'personal'
  | 'businessPath'
  | 'businessSetup'
  | 'businessJoin'
  | 'tenantAddendum'
  | 'complete';

type RecommendedStart = 'chat' | 'memory' | 'routes' | 'approvals' | 'settings';

type ChoiceState = {
  intent?: 'personal' | 'business';
  personalFocus?: RecommendedStart;
  businessPath?: 'setup' | 'join';
  setupPriority?: RecommendedStart;
  tenantFocus?: RecommendedStart;
  governance?: 'open' | 'balanced' | 'strict';
  selectedTenantId?: string;
};

type Option = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

const personalOptions: Option[] = [
  {
    id: 'memory',
    title: 'Build a reliable memory layer',
    description: 'Start by shaping what Stara should remember, verify, and forget.',
    icon: Network,
  },
  {
    id: 'routes',
    title: 'Route work to the right agent',
    description: 'Begin with the paths, handoffs, and defaults that steer everyday work.',
    icon: Route,
  },
  {
    id: 'approvals',
    title: 'Review sensitive actions',
    description: 'Start with approvals and policy checkpoints before Stara acts.',
    icon: ClipboardCheck,
  },
  {
    id: 'chat',
    title: 'Explore from chat',
    description: 'Start with a guided personal setup and let Stara recommend next steps.',
    icon: Sparkles,
  },
];

const businessOptions: Option[] = [
  {
    id: 'setup',
    title: 'Set up an org',
    description:
      'Prepare your preferences for a future org setup. Provisioning is handled elsewhere.',
    icon: Building2,
  },
  {
    id: 'join',
    title: 'Join an org',
    description: 'Check existing memberships and pending org invites before continuing.',
    icon: ChevronsRight,
  },
];

const tenantFocusOptions: Option[] = [
  {
    id: 'memory',
    title: 'Visible memory and sources',
    description: 'Understand which tenant memory layers and source data are available to you.',
    icon: Network,
  },
  {
    id: 'routes',
    title: 'Workflows and routing',
    description: 'Review the teams, workflows, and agent routes you can use.',
    icon: Route,
  },
  {
    id: 'approvals',
    title: 'Approvals and restricted actions',
    description: 'Focus on what requires review and what your role cannot access.',
    icon: ShieldCheck,
  },
];

const startRoutes: Record<RecommendedStart, string> = {
  chat: '/c/new',
  memory: '/stara/memory',
  routes: '/stara/routes',
  approvals: '/stara/approvals',
  settings: '/stara/settings',
};

const startLabels: Record<RecommendedStart, string> = {
  chat: 'chat',
  memory: 'memory',
  routes: 'routes',
  approvals: 'approvals',
  settings: 'settings',
};

const getRecommendedStart = (choice?: string): RecommendedStart => {
  if (
    choice === 'memory' ||
    choice === 'routes' ||
    choice === 'approvals' ||
    choice === 'settings'
  ) {
    return choice;
  }
  return 'chat';
};

const getReadinessScore = (choices: ChoiceState, context?: TStaraOnboardingContext | null) => {
  let score = 58;
  if (choices.personalFocus || choices.setupPriority || choices.tenantFocus) {
    score += 14;
  }
  if (choices.governance) {
    score += 10;
  }
  if (context?.activeMembership) {
    score += 8;
  }
  if ((context?.access.groups.length ?? 0) > 0 || (context?.access.grants.length ?? 0) > 0) {
    score += 6;
  }
  return Math.min(100, score);
};

export default function StaraOnboardingView() {
  const localize = useLocalize();
  useDocumentTitle(localize('com_ui_stara_onboarding_document_title'));

  const navigate = useNavigate();
  const location = useLocation();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { showToast } = useToastContext();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const reviewMode = searchParams.get('mode') === 'review';
  const redirectTo = searchParams.get('redirect_to');

  const [phase, setPhase] = useState<Phase>('intent');
  const [choices, setChoices] = useState<ChoiceState>({});
  const [latestContext, setLatestContext] = useState<TStaraOnboardingContext | null>(null);
  const [completedStart, setCompletedStart] = useState<RecommendedStart>('chat');
  const initialized = useRef(false);

  const query = useStaraOnboardingContextQuery();
  const saveMutation = useSaveStaraOnboardingMutation({
    onSuccess: (data) => setLatestContext(data),
  });
  const acceptInviteMutation = useAcceptStaraTenantInviteMutation({
    onSuccess: (data) => setLatestContext(data),
  });
  const activateTenantMutation = useActivateStaraTenantMutation({
    onSuccess: (data) => setLatestContext(data),
  });

  const context = latestContext ?? query.data ?? null;
  const isBusy =
    saveMutation.isLoading || acceptInviteMutation.isLoading || activateTenantMutation.isLoading;

  useEffect(() => {
    if (!context || initialized.current) {
      return;
    }
    initialized.current = true;
    setPhase(context.requiresTenantAddendum ? 'tenantAddendum' : 'intent');
  }, [context]);

  const finishAccount = async (
    mode: 'personal' | 'business_setup' | 'business_join' | 'business_join_pending',
    recommendedStart: RecommendedStart,
    extraResponses: Record<string, unknown> = {},
  ) => {
    const response = await saveMutation.mutateAsync({
      mode,
      recommendedStart,
      readinessScore: getReadinessScore(choices, context),
      responses: {
        ...choices,
        ...extraResponses,
      },
    });
    setLatestContext(response);
    setCompletedStart(recommendedStart);
    if (response.requiresTenantAddendum) {
      setPhase('tenantAddendum');
      return;
    }
    setPhase('complete');
  };

  const completeTenantAddendum = async () => {
    const tenantId = context?.activeMembership?.tenantId;
    if (!tenantId) {
      showToast({
        message: localize('com_ui_stara_onboarding_no_active_org_addendum'),
        status: 'error',
      });
      return;
    }
    const recommendedStart = getRecommendedStart(choices.tenantFocus);
    const response = await saveMutation.mutateAsync({
      mode: 'tenant_addendum',
      tenantId,
      recommendedStart,
      readinessScore: getReadinessScore(choices, context),
      responses: {
        tenantFocus: choices.tenantFocus,
        governance: choices.governance,
        activeTenantId: tenantId,
        orgName: context.activeMembership?.orgName,
        visibleScopes: context.access.scopes,
        groupCount: context.access.groups.length,
        grantCount: context.access.grants.length,
      },
    });
    setLatestContext(response);
    setCompletedStart(recommendedStart);
    setPhase('complete');
  };

  const handleMembershipSelection = async (membership: TStaraTenantMembership) => {
    const activated = await activateTenantMutation.mutateAsync(membership.tenantId);
    setLatestContext(activated);
    setChoices((prev) => ({ ...prev, selectedTenantId: membership.tenantId }));
    const saved = await saveMutation.mutateAsync({
      mode: 'business_join',
      recommendedStart: 'memory',
      readinessScore: getReadinessScore(choices, activated),
      responses: {
        ...choices,
        businessPath: 'join',
        selectedTenantId: membership.tenantId,
        orgName: membership.orgName,
      },
    });
    setLatestContext(saved);
    setPhase('tenantAddendum');
  };

  const handleInviteAcceptance = async (inviteId: string) => {
    const accepted = await acceptInviteMutation.mutateAsync(inviteId);
    const saved = await saveMutation.mutateAsync({
      mode: 'business_join',
      recommendedStart: 'memory',
      readinessScore: getReadinessScore(choices, accepted),
      responses: {
        ...choices,
        businessPath: 'join',
        acceptedInviteId: inviteId,
        activeTenantId: accepted.activeMembership?.tenantId,
      },
    });
    setLatestContext(saved);
    setPhase('tenantAddendum');
  };

  const closeReview = () => {
    navigate(redirectTo || '/stara/settings');
  };

  const continueAfterComplete = () => {
    navigate(startRoutes[completedStart] ?? redirectTo ?? '/c/new', { replace: true });
  };

  if (query.isLoading && !context) {
    return (
      <main className="flex h-full items-center justify-center bg-presentation text-text-primary">
        <Spinner className="h-8 w-8" />
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="flex h-full items-center justify-center bg-presentation p-6 text-text-primary">
        <div className="max-w-md rounded-lg border border-border-light bg-surface-primary p-5">
          <h1 className="text-lg font-semibold">
            {localize('com_ui_stara_onboarding_unavailable_title')}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {localize('com_ui_stara_onboarding_unavailable_description')}
          </p>
          <Button className="mt-4" onClick={() => navigate('/c/new')}>
            {localize('com_ui_stara_onboarding_return_to_chat')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-presentation text-text-primary">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
          <header className="flex items-start justify-between gap-4 border-b border-border-light pb-5">
            <div className="flex min-w-0 items-start gap-3">
              {isSmallScreen ? <OpenSidebar /> : null}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-secondary">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-text-secondary">
                  {localize('com_ui_settings_label_stara_onboarding')}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
                  {localize('com_ui_stara_onboarding_title')}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
                  {localize('com_ui_stara_onboarding_description')}
                </p>
              </div>
            </div>
            {reviewMode ? (
              <Button variant="outline" onClick={closeReview}>
                {localize('com_ui_close')}
              </Button>
            ) : null}
          </header>

          <Progress phase={phase} />

          <section className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              {phase === 'intent' ? (
                <StepPanel
                  eyebrow={context?.account.completed ? 'Review mode' : 'First question'}
                  title="Are you using Stara personally or for business?"
                  description="Personal onboarding remains valid if you join an org later. Business onboarding checks memberships and invites first."
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <OptionButton
                      icon={UserRound}
                      title="Personal"
                      description="Set up your own preferences, memory posture, and recommended Stara start."
                      selected={choices.intent === 'personal'}
                      onClick={() => {
                        setChoices((prev) => ({ ...prev, intent: 'personal' }));
                        setPhase('personal');
                      }}
                    />
                    <OptionButton
                      icon={Building2}
                      title="Business"
                      description="Join or prepare an org setup without assuming tenant access from your answers."
                      selected={choices.intent === 'business'}
                      onClick={() => {
                        setChoices((prev) => ({ ...prev, intent: 'business' }));
                        setPhase('businessPath');
                      }}
                    />
                  </div>
                </StepPanel>
              ) : null}

              {phase === 'personal' ? (
                <StepPanel
                  eyebrow="Personal setup"
                  title="What should Stara optimize first?"
                  description="This saves account-level onboarding only. You can still join an org later without losing this setup."
                  footer={
                    <StepActions
                      back={() => setPhase('intent')}
                      nextLabel="Complete personal onboarding"
                      nextDisabled={!choices.personalFocus || isBusy}
                      busy={isBusy}
                      next={() =>
                        finishAccount('personal', getRecommendedStart(choices.personalFocus))
                      }
                    />
                  }
                >
                  <OptionGrid
                    options={personalOptions}
                    selected={choices.personalFocus}
                    onSelect={(id) =>
                      setChoices((prev) => ({
                        ...prev,
                        personalFocus: getRecommendedStart(id),
                      }))
                    }
                  />
                </StepPanel>
              ) : null}

              {phase === 'businessPath' ? (
                <StepPanel
                  eyebrow="Business setup"
                  title="Are you setting up an org or joining one?"
                  description="Org is the user-facing label. The server treats tenants as the security boundary and scopes/groups/grants as access inside that tenant."
                  footer={<StepActions back={() => setPhase('intent')} />}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    {businessOptions.map((option) => (
                      <OptionButton
                        key={option.id}
                        icon={option.icon}
                        title={option.title}
                        description={option.description}
                        selected={choices.businessPath === option.id}
                        onClick={() => {
                          const businessPath = option.id === 'setup' ? 'setup' : 'join';
                          setChoices((prev) => ({ ...prev, businessPath }));
                          setPhase(businessPath === 'setup' ? 'businessSetup' : 'businessJoin');
                        }}
                      />
                    ))}
                  </div>
                </StepPanel>
              ) : null}

              {phase === 'businessSetup' ? (
                <StepPanel
                  eyebrow="Org setup intent"
                  title="What should the future org setup emphasize?"
                  description="Tenant creation is not part of this flow. Stara will save your intent and keep personal use available."
                  footer={
                    <StepActions
                      back={() => setPhase('businessPath')}
                      nextLabel="Save setup intent"
                      nextDisabled={!choices.setupPriority || isBusy}
                      busy={isBusy}
                      next={() =>
                        finishAccount('business_setup', getRecommendedStart(choices.setupPriority))
                      }
                    />
                  }
                >
                  <OptionGrid
                    options={tenantFocusOptions}
                    selected={choices.setupPriority}
                    onSelect={(id) =>
                      setChoices((prev) => ({
                        ...prev,
                        setupPriority: getRecommendedStart(id),
                      }))
                    }
                  />
                </StepPanel>
              ) : null}

              {phase === 'businessJoin' ? (
                <BusinessJoinStep
                  context={context}
                  busy={isBusy}
                  onBack={() => setPhase('businessPath')}
                  onSelectMembership={handleMembershipSelection}
                  onAcceptInvite={handleInviteAcceptance}
                  onPending={() => finishAccount('business_join_pending', 'chat')}
                />
              ) : null}

              {phase === 'tenantAddendum' ? (
                <TenantAddendumStep
                  context={context}
                  choices={choices}
                  busy={isBusy}
                  onChoose={(updates) => setChoices((prev) => ({ ...prev, ...updates }))}
                  onBack={reviewMode ? closeReview : undefined}
                  onComplete={completeTenantAddendum}
                />
              ) : null}

              {phase === 'complete' ? (
                <StepPanel
                  eyebrow="Ready"
                  title="Stara onboarding is up to date"
                  description={`Recommended start: ${startLabels[completedStart]}. You can rerun account onboarding or the active org addendum from Settings.`}
                  footer={
                    <div className="flex flex-wrap justify-end gap-2">
                      {reviewMode ? (
                        <Button variant="outline" onClick={closeReview}>
                          {localize('com_ui_close')}
                        </Button>
                      ) : null}
                      <Button onClick={continueAfterComplete}>
                        {localize('com_ui_continue')}
                        <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  }
                >
                  <div className="flex items-start gap-3 rounded-lg border border-border-light bg-surface-primary p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-active-alt">
                      <Check className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {context?.activeMembership
                          ? localize('com_ui_stara_onboarding_org_addendum_complete_var', {
                              orgName: context.activeMembership.orgName,
                            })
                          : localize('com_ui_stara_onboarding_account_complete')}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-text-secondary">
                        {localize('com_ui_stara_onboarding_no_access_granted')}
                      </p>
                    </div>
                  </div>
                </StepPanel>
              ) : null}
            </div>

            <ContextRail context={context} />
          </section>
        </div>
      </div>
    </main>
  );
}

function Progress({ phase }: { phase: Phase }) {
  const steps = [
    { id: 'intent', label: 'Intent' },
    { id: 'businessJoin', label: 'Membership' },
    { id: 'tenantAddendum', label: 'Org addendum' },
    { id: 'complete', label: 'Ready' },
  ];
  const phaseIndex: Record<Phase, number> = {
    intent: 0,
    personal: 0,
    businessPath: 0,
    businessSetup: 0,
    businessJoin: 1,
    tenantAddendum: 2,
    complete: 3,
  };
  const currentIndex = phaseIndex[phase];

  return (
    <div className="grid grid-cols-4 gap-2" aria-label="Onboarding progress">
      {steps.map((step, index) => {
        const active = index <= currentIndex || phase === 'personal' || phase === 'businessSetup';
        return (
          <div
            key={step.id}
            className={cn(
              'h-1.5 rounded-full transition-colors',
              active ? 'bg-text-primary' : 'bg-surface-tertiary',
            )}
            title={step.label}
          />
        );
      })}
    </div>
  );
}

function StepPanel({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-primary">
      <div className="border-b border-border-light p-5">
        <p className="text-xs font-semibold uppercase text-text-secondary">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-text-primary">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p>
      </div>
      <div className="p-5">{children}</div>
      {footer ? <div className="border-t border-border-light p-4">{footer}</div> : null}
    </div>
  );
}

function OptionGrid({
  options,
  selected,
  onSelect,
}: {
  options: Option[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {options.map((option) => (
        <OptionButton
          key={option.id}
          icon={option.icon}
          title={option.title}
          description={option.description}
          selected={selected === option.id}
          onClick={() => onSelect(option.id)}
        />
      ))}
    </div>
  );
}

function OptionButton({
  icon: Icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex min-h-[8.5rem] w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring',
        selected
          ? 'border-text-primary bg-surface-active-alt'
          : 'border-border-light bg-surface-secondary hover:bg-surface-hover',
      )}
      aria-pressed={selected}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-primary">
        <Icon className="h-5 w-5 text-text-primary" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text-primary">{title}</span>
        <span className="mt-2 block text-sm leading-6 text-text-secondary">{description}</span>
      </span>
    </button>
  );
}

function StepActions({
  back,
  next,
  nextLabel,
  nextDisabled,
  busy,
}: {
  back?: () => void;
  next?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  const localize = useLocalize();

  return (
    <div className="flex flex-wrap justify-between gap-2">
      {back ? (
        <Button variant="outline" onClick={back} disabled={busy}>
          {localize('com_ui_back')}
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button onClick={next} disabled={nextDisabled}>
          {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
          {nextLabel ?? localize('com_ui_continue')}
        </Button>
      ) : null}
    </div>
  );
}

function BusinessJoinStep({
  context,
  busy,
  onBack,
  onSelectMembership,
  onAcceptInvite,
  onPending,
}: {
  context: TStaraOnboardingContext | null;
  busy: boolean;
  onBack: () => void;
  onSelectMembership: (membership: TStaraTenantMembership) => void;
  onAcceptInvite: (inviteId: string) => void;
  onPending: () => void;
}) {
  const memberships =
    context?.memberships.filter((membership) => membership.status === 'active') ?? [];
  const invites = context?.pendingInvites ?? [];
  const localize = useLocalize();

  return (
    <StepPanel
      eyebrow="Join an org"
      title="Choose an existing org or accept an invite"
      description="Stara only shows memberships and invites resolved by the server. If nothing is available, personal use stays unblocked."
      footer={<StepActions back={onBack} busy={busy} />}
    >
      <div className="grid gap-5">
        {memberships.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {localize('com_ui_stara_onboarding_existing_memberships')}
            </h3>
            <div className="mt-3 grid gap-3">
              {memberships.map((membership) => (
                <button
                  key={membership.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onSelectMembership(membership)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary p-4 text-left transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">
                      {membership.orgName}
                    </span>
                    <span className="mt-1 block text-sm text-text-secondary">
                      {membership.roleLabel} - {membership.tenantId}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {invites.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {localize('com_ui_stara_onboarding_pending_invites')}
            </h3>
            <div className="mt-3 grid gap-3">
              {invites.map((invite) => (
                <button
                  key={invite.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onAcceptInvite(invite.id)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary p-4 text-left transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">
                      {invite.orgName}
                    </span>
                    <span className="mt-1 block text-sm text-text-secondary">
                      {invite.roleLabel}
                      {invite.invitedByName ? ` - invited by ${invite.invitedByName}` : ''}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {memberships.length === 0 && invites.length === 0 ? (
          <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {localize('com_ui_stara_onboarding_no_invite_title')}
                </h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  {localize('com_ui_stara_onboarding_no_invite_description')}
                </p>
                <Button className="mt-4" onClick={onPending} disabled={busy}>
                  {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
                  {localize('com_ui_stara_onboarding_finish_pending_join')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </StepPanel>
  );
}

function TenantAddendumStep({
  context,
  choices,
  busy,
  onChoose,
  onBack,
  onComplete,
}: {
  context: TStaraOnboardingContext | null;
  choices: ChoiceState;
  busy: boolean;
  onChoose: (updates: Partial<ChoiceState>) => void;
  onBack?: () => void;
  onComplete: () => void;
}) {
  const activeMembership = context?.activeMembership;
  const canComplete = Boolean(activeMembership && choices.tenantFocus && choices.governance);
  const localize = useLocalize();

  return (
    <StepPanel
      eyebrow="Org addendum"
      title={
        activeMembership
          ? `Review access for ${activeMembership.orgName}`
          : 'Review your active org access'
      }
      description="Tenant access is server-resolved. This addendum explains what is visible and where your role appears restricted."
      footer={
        <StepActions
          back={onBack}
          busy={busy}
          nextLabel="Complete org addendum"
          nextDisabled={!canComplete || busy}
          next={onComplete}
        />
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryTile label="Active org" value={activeMembership?.orgName ?? 'None'} />
          <SummaryTile label="Role label" value={activeMembership?.roleLabel ?? 'Unavailable'} />
          <SummaryTile
            label="Scoped access"
            value={
              context?.access.scopes.length
                ? `${context.access.scopes.length} scopes`
                : 'Server defaults'
            }
          />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {localize('com_ui_stara_onboarding_tenant_focus_title')}
          </h3>
          <div className="mt-3">
            <OptionGrid
              options={tenantFocusOptions}
              selected={choices.tenantFocus}
              onSelect={(id) => onChoose({ tenantFocus: getRecommendedStart(id) })}
            />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {localize('com_ui_stara_onboarding_restricted_title')}
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              [
                'open',
                'Show available areas first',
                'Keep unavailable tenant areas out of the way.',
              ],
              [
                'balanced',
                'Explain limits inline',
                'Show why a source, workflow, or lane is unavailable.',
              ],
              [
                'strict',
                'Prefer review gates',
                'Make sensitive actions explicit before continuing.',
              ],
            ].map(([id, title, description]) => (
              <button
                key={id}
                type="button"
                onClick={() => onChoose({ governance: id as ChoiceState['governance'] })}
                className={cn(
                  'min-h-[7rem] rounded-lg border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring',
                  choices.governance === id
                    ? 'border-text-primary bg-surface-active-alt'
                    : 'border-border-light bg-surface-secondary hover:bg-surface-hover',
                )}
                aria-pressed={choices.governance === id}
              >
                <span className="block text-sm font-semibold text-text-primary">{title}</span>
                <span className="mt-2 block text-sm leading-6 text-text-secondary">
                  {description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary">
            {localize('com_ui_stara_onboarding_access_summary_title')}
          </h3>
          <div className="mt-3 grid gap-2 text-sm text-text-secondary">
            <AccessLine
              label="Groups"
              value={
                context?.access.groups.length
                  ? context.access.groups.map((group) => group.name).join(', ')
                  : 'No groups returned'
              }
            />
            <AccessLine
              label="Grants"
              value={
                context?.access.grants.length
                  ? context.access.grants.map((grant) => grant.capability).join(', ')
                  : 'No explicit grants returned'
              }
            />
            <AccessLine
              label="Restricted"
              value={
                context?.access.restrictedAreas.length
                  ? context.access.restrictedAreas.join(' ')
                  : 'None reported by onboarding context'
              }
            />
          </div>
        </div>
      </div>
    </StepPanel>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary p-4">
      <p className="text-xs font-medium uppercase text-text-secondary">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function AccessLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <span className="font-medium text-text-primary">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function ContextRail({ context }: { context: TStaraOnboardingContext | null }) {
  const localize = useLocalize();
  const accountStatus = context?.account.completed
    ? localize('com_ui_stara_onboarding_status_complete')
    : localize('com_ui_stara_onboarding_status_required');

  let tenantStatus = localize('com_ui_stara_onboarding_no_active_org');
  if (context?.activeMembership) {
    tenantStatus = context.requiresTenantAddendum
      ? localize('com_ui_stara_onboarding_addendum_required')
      : localize('com_ui_stara_onboarding_addendum_complete');
  }

  return (
    <aside className="grid h-fit gap-3">
      <div className="rounded-lg border border-border-light bg-surface-primary p-4">
        <h2 className="text-sm font-semibold text-text-primary">
          {localize('com_ui_stara_onboarding_account_status')}
        </h2>
        <div className="mt-3 grid gap-2">
          <RailLine icon={UserRound} label="Personal onboarding" value={accountStatus} />
          <RailLine
            icon={Building2}
            label="Active org"
            value={context?.activeMembership?.orgName ?? 'None'}
          />
          <RailLine icon={ShieldCheck} label="Org addendum" value={tenantStatus} />
        </div>
      </div>

      <div className="rounded-lg border border-border-light bg-surface-primary p-4">
        <h2 className="text-sm font-semibold text-text-primary">
          {localize('com_ui_stara_onboarding_scoped_access')}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill icon={Map} label={`${context?.access.scopes.length ?? 0} scopes`} />
          <Pill icon={Network} label={`${context?.access.groups.length ?? 0} groups`} />
          <Pill icon={LockKeyhole} label={`${context?.access.grants.length ?? 0} grants`} />
        </div>
        <p className="mt-3 text-xs leading-5 text-text-secondary">
          {localize('com_ui_stara_onboarding_access_note')}
        </p>
      </div>
    </aside>
  );
}

function RailLine({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="truncate text-sm font-medium text-text-primary">{value}</p>
      </div>
    </div>
  );
}

function Pill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-secondary">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
