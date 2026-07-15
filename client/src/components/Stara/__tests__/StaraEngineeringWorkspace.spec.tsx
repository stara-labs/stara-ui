import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TStaraEngineeringContext } from 'librechat-data-provider';
import StaraEngineeringWorkspace from '../StaraEngineeringWorkspace';

const mockShowToast = jest.fn();
const mockContextQuery = jest.fn();
const mockRunQuery = jest.fn();
const mockCreateTask = jest.fn();
const mockStartRun = jest.fn();
const mockDecideRun = jest.fn();
const mockUpdateBusinessProfile = jest.fn();
const mockUpdatePolicy = jest.fn();

const idleMutation = () => ({ isLoading: false, mutateAsync: jest.fn() });

jest.mock('@librechat/client', () => ({
  Button: ({ asChild, children, size, variant, ...props }: any) => {
    void size;
    void variant;
    if (asChild) {
      return children;
    }
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  },
  Spinner: (props: any) => <span data-testid="spinner" {...props} />,
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useStaraEngineeringContextQuery: () => mockContextQuery(),
  useStaraEngineeringRunQuery: (runId?: string) => mockRunQuery(runId),
  useCreateStaraEngineeringTaskMutation: () => ({
    isLoading: false,
    mutateAsync: mockCreateTask,
  }),
  useStartStaraEngineeringRunMutation: () => ({
    isLoading: false,
    mutateAsync: mockStartRun,
  }),
  useDecideStaraEngineeringRunMutation: () => ({
    isLoading: false,
    mutateAsync: mockDecideRun,
  }),
  useCancelStaraEngineeringRunMutation: idleMutation,
  useRetryStaraEngineeringRunMutation: idleMutation,
  useResumeStaraEngineeringRunMutation: idleMutation,
  useCreateStaraEngineeringRepositoryMutation: idleMutation,
  useUpdateStaraBusinessProfileMutation: () => ({
    isLoading: false,
    mutateAsync: mockUpdateBusinessProfile,
  }),
  useUpdateStaraEngineeringPolicyMutation: () => ({
    isLoading: false,
    mutateAsync: mockUpdatePolicy,
  }),
}));

const repository = {
  id: 'repo-1',
  tenant_id: 'tenant-1',
  provider: 'github' as const,
  provider_repository_id: '123',
  repository_owner: 'stara-labs',
  repository_name: 'stara-ui',
  default_branch: 'main',
  installation_id: '456',
  status: 'active' as const,
  check_profiles: [],
  deployment_target: null,
  risk_paths: [],
  created_by_user_id: 'user-1',
  version: 1,
  created_at: '2026-07-14T12:00:00.000Z',
  updated_at: '2026-07-14T12:00:00.000Z',
};

const task = {
  id: 'task-1',
  tenant_id: 'tenant-1',
  created_by_user_id: 'user-1',
  idempotency_key: 'task-key',
  title: 'Improve Stara task controls',
  goal: 'Make governed delivery visible to the team.',
  acceptance_criteria: ['The task reaches a protected pull request.'],
  risk_class: 'medium' as const,
  target_environment: 'staging' as const,
  status: 'running' as const,
  metadata_redacted: {},
  version: 2,
  created_action_version_id: 'action-1',
  created_at: '2026-07-14T12:00:00.000Z',
  updated_at: '2026-07-14T12:05:00.000Z',
};

const run = {
  id: 'run-1',
  tenant_id: 'tenant-1',
  task_id: task.id,
  attempt: 1,
  retry_of_run_id: null,
  status: 'waiting_for_approval' as const,
  current_stage: 'pull_request',
  trace_id: 'trace-1',
  idempotency_key: 'run-key',
  started_by_user_id: 'user-1',
  block_reason_redacted: null,
  metadata_redacted: {},
  version: 4,
  created_at: '2026-07-14T12:01:00.000Z',
  updated_at: '2026-07-14T12:05:00.000Z',
  completed_at: null,
};

const event = {
  id: 'event-1',
  tenant_id: 'tenant-1',
  run_id: run.id,
  run_version: 4,
  event_type: 'pull_request_opened',
  from_status: 'executing' as const,
  to_status: 'waiting_for_approval' as const,
  stage: 'pull_request',
  summary_redacted: 'Draft pull request opened after required checks passed.',
  evidence_refs: [
    {
      evidence_type: 'pull_request' as const,
      provider: 'github',
      external_id: '42',
      url: 'https://github.com/stara-labs/stara-ui/pull/42',
      conclusion: 'pending' as const,
    },
  ],
  metadata_redacted: {},
  idempotency_key: 'event-key',
  action_version_id: 'action-2',
  created_at: '2026-07-14T12:05:00.000Z',
};

function context(overrides: Partial<TStaraEngineeringContext> = {}): TStaraEngineeringContext {
  return {
    active_tenant_id: 'tenant-1',
    active_org_name: 'Stara Labs',
    actor_role_key: 'owner',
    permissions: {
      can_connect_repository: true,
      can_create_task: true,
      can_decide_approval: true,
      can_update_policy: true,
      can_update_business_profile: true,
    },
    repositories: [repository],
    tasks: [{ task, repositories: [], latest_run: run }],
    approvals: [],
    business_profile: null,
    policy_config: null,
    readiness: null,
    ...overrides,
  };
}

function renderWorkspace(view: 'workflows' | 'approvals' | 'activity' | 'settings') {
  return render(
    <MemoryRouter>
      <StaraEngineeringWorkspace view={view} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockContextQuery.mockReturnValue({
    data: context(),
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockRunQuery.mockReturnValue({
    data: { run, task, repositories: [], events: [event] },
    isLoading: false,
  });
  mockCreateTask.mockResolvedValue({
    task: { ...task, id: 'task-new' },
    repositories: [],
    latest_run: null,
  });
  mockStartRun.mockResolvedValue({ run, task, repositories: [], events: [] });
  mockDecideRun.mockResolvedValue({});
  mockUpdateBusinessProfile.mockResolvedValue({});
  mockUpdatePolicy.mockResolvedValue({});
});

describe('StaraEngineeringWorkspace', () => {
  it('sends users without an active business to onboarding', () => {
    mockContextQuery.mockReturnValue({
      data: context({ active_tenant_id: null, active_org_name: null, repositories: [], tasks: [] }),
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    renderWorkspace('workflows');

    expect(
      screen.getByRole('heading', { name: 'Complete business onboarding' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open onboarding' })).toHaveAttribute(
      'href',
      '/onboarding?redirect_to=/stara/settings',
    );
  });

  it('renders the live task, run timeline, and external evidence', () => {
    renderWorkspace('workflows');

    expect(screen.getAllByText(task.title).length).toBeGreaterThan(0);
    expect(screen.getByText(event.summary_redacted)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PR 42/ })).toHaveAttribute(
      'href',
      event.evidence_refs[0].url,
    );
  });

  it('creates and starts a scoped engineering task', async () => {
    renderWorkspace('workflows');

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Ship safer updates' },
    });
    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'Add candidate verification.' },
    });
    fireEvent.change(screen.getByLabelText(/Acceptance criteria/), {
      target: { value: 'Candidate is verified\nTraffic can be rolled back' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));

    await waitFor(() => expect(mockCreateTask).toHaveBeenCalledTimes(1));
    expect(mockCreateTask.mock.calls[0][0]).toMatchObject({
      title: 'Ship safer updates',
      goal: 'Add candidate verification.',
      acceptance_criteria: ['Candidate is verified', 'Traffic can be rolled back'],
      repositories: [{ repository_connection_id: repository.id, dependency_order: 0 }],
    });
    await waitFor(() =>
      expect(mockStartRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-new' })),
    );
  });

  it('submits a version-bound approval decision', async () => {
    mockContextQuery.mockReturnValue({
      data: context({
        approvals: [
          {
            review_item_id: 'review-1',
            tenant_id: 'tenant-1',
            run_id: run.id,
            run_version: run.version,
            target: 'merge',
            status: 'pending',
            required_role_keys: ['owner'],
            summary_redacted: { summary: 'Checks passed; merge requires an owner.' },
            decision: null,
            decided_by_user_id: null,
            decision_reason_redacted: null,
            created_at: '2026-07-14T12:05:00.000Z',
            updated_at: '2026-07-14T12:05:00.000Z',
            decided_at: null,
          },
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    renderWorkspace('approvals');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockDecideRun).toHaveBeenCalledTimes(1));
    expect(mockDecideRun.mock.calls[0][0]).toMatchObject({
      runId: run.id,
      payload: {
        target: 'merge',
        decision: 'approved',
        expected_version: run.version,
      },
    });
  });

  it('updates canonical business context and immutable approver-role policy', async () => {
    mockContextQuery.mockReturnValue({
      data: context({
        business_profile: {
          tenant_id: 'tenant-1',
          business_summary: 'Stara builds governed software delivery.',
          primary_outcomes: ['Ship safe improvements'],
          critical_workflows: ['Task to deployment'],
          operating_constraints: ['Keep the active release available'],
          updated_by_user_id: 'user-1',
          updated_at: '2026-07-15T00:00:00.000Z',
        },
        policy_config: {
          tenant_id: 'tenant-1',
          template_key: 'regulated_default',
          regulated_data_classes: ['pii', 'phi', 'financial', 'confidential'],
          secure_inference_required: true,
          frontier_projection_mode: 'deidentified_only',
          missing_context_behavior: 'fail_closed',
          review_required_for_unknown_sensitivity: true,
          redacted_observations_required: true,
          engineering_delivery: {
            review_required: true,
            merge_approval_required: true,
            deployment_approval_required: true,
            merge_approver_role_keys: ['owner', 'admin'],
            deployment_approver_role_keys: ['owner', 'admin'],
            required_ci_check_names: ['test'],
            max_repair_attempts: 5,
            max_immediate_steps: 25,
            branch_prefix: 'stara',
            pull_request_draft: true,
            coding_model: 'gpt-5.4',
            coding_grant_ttl_seconds: 3600,
            coding_max_requests: 100,
            coding_max_request_bytes: 2097152,
            coding_max_input_tokens: 1000000,
            coding_max_output_tokens: 500000,
            coding_max_output_tokens_per_request: 64000,
          },
          updated_by_user_id: 'user-1',
          updated_at: '2026-07-15T00:00:00.000Z',
        },
      }),
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    renderWorkspace('settings');

    fireEvent.change(screen.getByLabelText('Business summary'), {
      target: { value: 'Stara safely improves its own control plane.' },
    });
    fireEvent.change(screen.getByLabelText(/Primary outcomes/), {
      target: { value: 'Ship safe improvements\nKeep service available' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save business context' }));

    await waitFor(() => expect(mockUpdateBusinessProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateBusinessProfile).toHaveBeenCalledWith({
      business_summary: 'Stara safely improves its own control plane.',
      primary_outcomes: ['Ship safe improvements', 'Keep service available'],
      critical_workflows: ['Task to deployment'],
      operating_constraints: ['Keep the active release available'],
    });

    const mergeApprovers = screen.getByRole('group', { name: 'Merge approvers' });
    fireEvent.click(within(mergeApprovers).getByRole('checkbox', { name: 'owner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    await waitFor(() => expect(mockUpdatePolicy).toHaveBeenCalledTimes(1));
    expect(mockUpdatePolicy.mock.calls[0][0]).toMatchObject({
      engineering_delivery: {
        merge_approver_role_keys: ['admin'],
        deployment_approver_role_keys: ['owner', 'admin'],
      },
    });
  });
});
