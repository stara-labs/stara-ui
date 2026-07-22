/* eslint-disable i18next/no-literal-string */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Spinner, useToastContext } from '@librechat/client';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CircleDot,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  StaraEngineeringApproverRoleKey,
  StaraEngineeringRiskClass,
  StaraEngineeringTargetEnvironment,
  TCreateStaraEngineeringRepositoryRequest,
  TStaraEngineeringApproval,
  TStaraEngineeringContext,
  TStaraEngineeringEvidenceReference,
  TStaraEngineeringRepository,
  TStaraEngineeringRunAggregate,
  TStaraEngineeringTaskAggregate,
} from 'librechat-data-provider';
import type { ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  useCancelStaraEngineeringRunMutation,
  useCreateStaraEngineeringRepositoryMutation,
  useCreateStaraEngineeringTaskMutation,
  useDecideStaraEngineeringRunMutation,
  useResumeStaraEngineeringRunMutation,
  useRetryStaraEngineeringRunMutation,
  useStaraEngineeringContextQuery,
  useStaraEngineeringRunQuery,
  useStartStaraEngineeringRunMutation,
  useUpdateStaraBusinessProfileMutation,
  useUpdateStaraEngineeringPolicyMutation,
  useUpdateStaraEngineeringRepositoryMutation,
} from '~/data-provider';
import { cn } from '~/utils';

export type StaraEngineeringView = 'workflows' | 'approvals' | 'activity' | 'settings';

const terminalRunStatuses = new Set(['completed', 'cancelled', 'failed', 'rolled_back']);
const retryableRunStatuses = new Set(['cancelled', 'failed', 'rolled_back']);
const linesFrom = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export default function StaraEngineeringWorkspace({ view }: { view: StaraEngineeringView }) {
  const query = useStaraEngineeringContextQuery();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const tasks = useMemo(() => query.data?.tasks ?? [], [query.data?.tasks]);

  useEffect(() => {
    if (!selectedTaskId && tasks[0]) {
      setSelectedTaskId(tasks[0].task.id);
      return;
    }
    if (
      selectedTaskId &&
      tasks.length > 0 &&
      !tasks.some(({ task }) => task.id === selectedTaskId)
    ) {
      setSelectedTaskId(tasks[0].task.id);
    }
  }, [selectedTaskId, tasks]);

  const selectedTask = tasks.find(({ task }) => task.id === selectedTaskId) ?? tasks[0] ?? null;
  const runQuery = useStaraEngineeringRunQuery(selectedTask?.latest_run?.id);

  if (query.isLoading && !query.data) {
    return <CenteredState icon={<Spinner className="h-6 w-6" />} title="Loading live work" />;
  }

  if (query.isError || !query.data) {
    return (
      <CenteredState
        icon={<AlertTriangle className="h-5 w-5" />}
        title="Engineering workspace unavailable"
        description="The canonical Stara engineering API could not be reached."
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        }
      />
    );
  }

  if (!query.data.active_tenant_id) {
    return (
      <CenteredState
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Complete business onboarding"
        description="Create or activate an organization before connecting repositories or starting engineering work."
        action={
          <Button asChild>
            <Link to="/onboarding?redirect_to=/stara/settings">Open onboarding</Link>
          </Button>
        }
      />
    );
  }

  if (!query.data.platform_engineering_access) {
    return null;
  }

  if (view === 'approvals') {
    return <ApprovalsView context={query.data} />;
  }
  if (view === 'settings') {
    return <EngineeringSettings context={query.data} />;
  }
  if (view === 'activity') {
    return (
      <ActivityView
        context={query.data}
        selectedTask={selectedTask}
        run={runQuery.data ?? null}
        onSelectTask={setSelectedTaskId}
      />
    );
  }

  return (
    <WorkflowsView
      context={query.data}
      selectedTask={selectedTask}
      run={runQuery.data ?? null}
      runLoading={runQuery.isLoading}
      onSelectTask={setSelectedTaskId}
    />
  );
}

function WorkflowsView({
  context,
  selectedTask,
  run,
  runLoading,
  onSelectTask,
}: {
  context: TStaraEngineeringContext;
  selectedTask: TStaraEngineeringTaskAggregate | null;
  run: TStaraEngineeringRunAggregate | null;
  runLoading: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  const [showTaskForm, setShowTaskForm] = useState(false);
  const pendingApprovals = context.approvals.filter((approval) => approval.status === 'pending');

  return (
    <div className="grid gap-5">
      <WorkspaceSummary context={context} />

      {context.repositories.length === 0 ? (
        <InlineNotice
          icon={Settings2}
          title="Connect the first repository"
          description="Engineering tasks stay disabled until an owner or admin connects a GitHub App installation and check profile."
          action={
            <Button asChild variant="outline">
              <Link to="/stara/settings">Open engineering setup</Link>
            </Button>
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light pb-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Engineering tasks</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Scoped changes move through checks, pull request review, approvals, and deployment.
          </p>
        </div>
        <Button
          onClick={() => setShowTaskForm((current) => !current)}
          disabled={!context.permissions.can_create_task || context.repositories.length === 0}
        >
          {showTaskForm ? <X className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showTaskForm ? 'Close' : 'New task'}
        </Button>
      </div>

      {showTaskForm ? (
        <TaskForm context={context} onCreated={(taskId) => onSelectTask(taskId)} />
      ) : null}

      <div className="grid min-h-[32rem] gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <TaskQueue
          tasks={context.tasks}
          selectedTaskId={selectedTask?.task.id ?? null}
          onSelect={onSelectTask}
        />
        <RunDetail task={selectedTask} run={run} loading={runLoading} />
      </div>

      {pendingApprovals.length > 0 ? (
        <InlineNotice
          icon={ShieldCheck}
          title={`${pendingApprovals.length} protected action${pendingApprovals.length === 1 ? '' : 's'} waiting`}
          description="Merge and deployment gates remain stopped until an owner or admin reviews the evidence."
          action={
            <Button asChild variant="outline">
              <Link to="/stara/approvals">Review approvals</Link>
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

function WorkspaceSummary({ context }: { context: TStaraEngineeringContext }) {
  const activeRuns = context.tasks.filter(
    ({ latest_run }) => latest_run && !terminalRunStatuses.has(latest_run.status),
  ).length;
  const pendingApprovals = context.approvals.filter(({ status }) => status === 'pending').length;
  return (
    <div className="grid border-y border-border-light sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCell label="Organization" value={context.active_org_name ?? 'Unavailable'} />
      <SummaryCell label="Repositories" value={String(context.repositories.length)} />
      <SummaryCell label="Active runs" value={String(activeRuns)} />
      <SummaryCell label="Pending approvals" value={String(pendingApprovals)} />
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border-light px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="text-xs font-medium uppercase text-text-secondary">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function TaskForm({
  context,
  onCreated,
}: {
  context: TStaraEngineeringContext;
  onCreated: (taskId: string) => void;
}) {
  const { showToast } = useToastContext();
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [criteria, setCriteria] = useState('');
  const [repositoryId, setRepositoryId] = useState(context.repositories[0]?.id ?? '');
  const [riskClass, setRiskClass] = useState<StaraEngineeringRiskClass>('medium');
  const [targetEnvironment, setTargetEnvironment] =
    useState<StaraEngineeringTargetEnvironment>('staging');
  const [startImmediately, setStartImmediately] = useState(true);
  const createTask = useCreateStaraEngineeringTaskMutation();
  const startRun = useStartStaraEngineeringRunMutation();
  const busy = createTask.isLoading || startRun.isLoading;

  const submit = async () => {
    const acceptanceCriteria = criteria
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!title.trim() || !goal.trim() || acceptanceCriteria.length === 0 || !repositoryId) {
      showToast({
        message: 'Title, goal, repository, and at least one acceptance criterion are required.',
        status: 'error',
      });
      return;
    }

    try {
      const task = await createTask.mutateAsync({
        idempotency_key: operationKey('task'),
        title: title.trim(),
        goal: goal.trim(),
        acceptance_criteria: acceptanceCriteria,
        risk_class: riskClass,
        target_environment: targetEnvironment,
        repositories: [{ repository_connection_id: repositoryId, dependency_order: 0 }],
        metadata_redacted: { source: 'stara-ui' },
      });
      onCreated(task.task.id);
      if (startImmediately) {
        await startRun.mutateAsync({
          taskId: task.task.id,
          payload: {
            idempotency_key: operationKey('run'),
            metadata_redacted: { source: 'stara-ui' },
          },
        });
      }
      setTitle('');
      setGoal('');
      setCriteria('');
      showToast({
        message: startImmediately ? 'Task created and queued.' : 'Task created.',
        status: 'success',
      });
    } catch (error) {
      showToast({ message: errorMessage(error), status: 'error' });
    }
  };

  return (
    <section className="grid gap-4 border-b border-border-light pb-5" aria-label="New task">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Task title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Repository">
          <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
            {context.repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.repository_owner}/{repository.repository_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Goal">
        <textarea
          className="min-h-24"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
        />
      </Field>
      <Field label="Acceptance criteria" hint="One verifiable outcome per line">
        <textarea
          className="min-h-28"
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Risk class">
          <select
            value={riskClass}
            onChange={(event) => setRiskClass(event.target.value as StaraEngineeringRiskClass)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </Field>
        <Field label="Target environment">
          <select
            value={targetEnvironment}
            onChange={(event) =>
              setTargetEnvironment(event.target.value as StaraEngineeringTargetEnvironment)
            }
          >
            <option value="none">No deployment</option>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={startImmediately}
            onChange={(event) => setStartImmediately(event.target.checked)}
          />
          Start the governed run after creation
        </label>
        <Button onClick={submit} disabled={busy}>
          {busy ? <Spinner className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
          {startImmediately ? 'Create and start' : 'Create task'}
        </Button>
      </div>
    </section>
  );
}

function TaskQueue({
  tasks,
  selectedTaskId,
  onSelect,
}: {
  tasks: TStaraEngineeringTaskAggregate[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}) {
  return (
    <section className="min-w-0 border border-border-light" aria-label="Task queue">
      <div className="border-b border-border-light px-3 py-2 text-xs font-semibold uppercase text-text-secondary">
        Queue
      </div>
      {tasks.length === 0 ? (
        <div className="p-4 text-sm leading-6 text-text-secondary">
          No engineering tasks yet. Create a scoped improvement to begin.
        </div>
      ) : (
        <div className="divide-y divide-border-light">
          {tasks.map((aggregate) => (
            <button
              key={aggregate.task.id}
              type="button"
              onClick={() => onSelect(aggregate.task.id)}
              className={cn(
                'grid w-full gap-2 px-3 py-3 text-left transition-colors hover:bg-surface-hover',
                selectedTaskId === aggregate.task.id && 'bg-surface-active-alt',
              )}
            >
              <span className="line-clamp-2 text-sm font-medium text-text-primary">
                {aggregate.task.title}
              </span>
              <span className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                <StatusText status={aggregate.latest_run?.status ?? aggregate.task.status} />
                <span>{formatDate(aggregate.task.updated_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function RunDetail({
  task,
  run,
  loading,
}: {
  task: TStaraEngineeringTaskAggregate | null;
  run: TStaraEngineeringRunAggregate | null;
  loading: boolean;
}) {
  const { showToast } = useToastContext();
  const startRun = useStartStaraEngineeringRunMutation();
  const cancelRun = useCancelStaraEngineeringRunMutation();
  const retryRun = useRetryStaraEngineeringRunMutation();
  const resumeRun = useResumeStaraEngineeringRunMutation();
  const busy =
    startRun.isLoading || cancelRun.isLoading || retryRun.isLoading || resumeRun.isLoading;

  if (!task) {
    return (
      <CenteredState
        icon={<CircleDot className="h-5 w-5" />}
        title="No task selected"
        description="Create a task to see its governed delivery timeline."
      />
    );
  }

  const currentRun = run?.run ?? task.latest_run;
  const perform = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      showToast({ message: success, status: 'success' });
    } catch (error) {
      showToast({ message: errorMessage(error), status: 'error' });
    }
  };

  return (
    <section className="min-w-0 border border-border-light" aria-label="Selected task">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-light p-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-text-secondary">
            {task.task.risk_class} risk / {task.task.target_environment}
          </div>
          <h3 className="mt-1 text-base font-semibold text-text-primary">{task.task.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">{task.task.goal}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {currentRun ? <StatusBadge status={currentRun.status} /> : null}
          {!currentRun ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                perform(
                  () =>
                    startRun.mutateAsync({
                      taskId: task.task.id,
                      payload: { idempotency_key: operationKey('run') },
                    }),
                  'Run queued.',
                )
              }
            >
              <Play className="mr-2 h-4 w-4" />
              Start
            </Button>
          ) : null}
          {currentRun && !terminalRunStatuses.has(currentRun.status) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                perform(
                  () =>
                    cancelRun.mutateAsync({
                      runId: currentRun.id,
                      expectedVersion: currentRun.version,
                    }),
                  'Run cancelled.',
                )
              }
            >
              <Square className="mr-2 h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : null}
          {currentRun && retryableRunStatuses.has(currentRun.status) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                perform(
                  () =>
                    retryRun.mutateAsync({
                      runId: currentRun.id,
                      payload: { idempotency_key: operationKey('retry') },
                    }),
                  'Retry queued.',
                )
              }
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          ) : null}
          {currentRun?.status === 'blocked' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                perform(
                  () =>
                    resumeRun.mutateAsync({
                      runId: currentRun.id,
                      expectedVersion: currentRun.version,
                      idempotencyKey: operationKey('resume'),
                      reasonRedacted: 'Operator resolved the reported blocker.',
                    }),
                  'Run resumed.',
                )
              }
            >
              <Play className="mr-2 h-4 w-4" />
              Resume
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 p-4">
        <div>
          <h4 className="text-xs font-semibold uppercase text-text-secondary">Acceptance</h4>
          <ul className="mt-2 grid gap-2">
            {task.task.acceptance_criteria.map((criterion) => (
              <li key={criterion} className="flex items-start gap-2 text-sm text-text-secondary">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>

        {loading && !run ? <Spinner className="h-5 w-5" /> : null}
        {run ? <EvidenceStrip events={run.events} /> : null}
        {run ? <RunTimeline run={run} /> : null}
        {currentRun?.block_reason_redacted ? (
          <InlineNotice
            icon={AlertTriangle}
            title="Run blocked"
            description={currentRun.block_reason_redacted}
          />
        ) : null}
      </div>
    </section>
  );
}

function EvidenceStrip({ events }: { events: TStaraEngineeringRunAggregate['events'] }) {
  const evidence = useMemo(
    () => uniqueEvidence(events.flatMap((event) => event.evidence_refs)),
    [events],
  );
  if (evidence.length === 0) {
    return null;
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-text-secondary">Evidence</h4>
      <div className="mt-2 flex flex-wrap gap-2">
        {evidence.map((item) => {
          const label = evidenceLabel(item);
          return item.url ? (
            <a
              key={`${item.evidence_type}:${item.external_id}`}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-2 border border-border-light px-3 text-sm font-medium text-text-primary hover:bg-surface-hover"
            >
              {label}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span
              key={`${item.evidence_type}:${item.external_id}`}
              className="inline-flex min-h-9 items-center border border-border-light px-3 text-sm text-text-secondary"
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function RunTimeline({ run }: { run: TStaraEngineeringRunAggregate }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-text-secondary">Run timeline</h4>
      <ol className="mt-2 border-l border-border-medium">
        {run.events.map((event) => (
          <li key={event.id} className="relative grid gap-1 pb-4 pl-5 last:pb-0">
            <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border border-border-heavy bg-surface-primary" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-text-primary">
                {humanize(event.event_type)}
              </span>
              <span className="text-xs text-text-secondary">{formatDate(event.created_at)}</span>
            </div>
            <p className="text-sm leading-6 text-text-secondary">{event.summary_redacted}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ApprovalsView({ context }: { context: TStaraEngineeringContext }) {
  const approvals = context.approvals.filter((approval) => approval.status === 'pending');
  return (
    <div className="grid gap-4">
      <div className="border-b border-border-light pb-3">
        <h2 className="text-base font-semibold text-text-primary">Protected actions</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Decisions are version-bound. Stale evidence or a changed run forces a fresh review.
        </p>
      </div>
      {approvals.length === 0 ? (
        <CenteredState
          icon={<ShieldCheck className="h-5 w-5" />}
          title="No approvals waiting"
          description="Merge and deployment requests will appear here with their evidence."
        />
      ) : (
        <div className="divide-y divide-border-light border-y border-border-light">
          {approvals.map((approval) => (
            <ApprovalRow
              key={approval.review_item_id}
              approval={approval}
              canDecide={context.permissions.can_decide_approval}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalRow({
  approval,
  canDecide,
}: {
  approval: TStaraEngineeringApproval;
  canDecide: boolean;
}) {
  const { showToast } = useToastContext();
  const [reason, setReason] = useState('Reviewed the current redacted evidence and policy gate.');
  const decision = useDecideStaraEngineeringRunMutation();
  const evidence = approvalEvidence(approval);

  const decide = async (value: 'approved' | 'rejected') => {
    try {
      await decision.mutateAsync({
        runId: approval.run_id,
        payload: {
          target: approval.target,
          decision: value,
          expected_version: approval.run_version,
          idempotency_key: operationKey(`decision-${approval.review_item_id}`),
          reason_redacted: reason.trim(),
        },
      });
      showToast({ message: `${humanize(approval.target)} ${value}.`, status: 'success' });
    } catch (error) {
      showToast({ message: errorMessage(error), status: 'error' });
    }
  };

  return (
    <article className="grid gap-4 py-4 lg:grid-cols-[12rem_minmax(0,1fr)_16rem]">
      <div>
        <div className="text-xs font-semibold uppercase text-text-secondary">{approval.target}</div>
        <div className="mt-1 text-sm font-medium text-text-primary">
          Run {approval.run_id.slice(0, 8)}
        </div>
        <div className="mt-1 text-xs text-text-secondary">Version {approval.run_version}</div>
      </div>
      <div className="min-w-0">
        <p className="text-sm leading-6 text-text-secondary">{approvalSummary(approval)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {evidence.map((item) => (
            <a
              key={`${item.evidence_type}:${item.external_id}`}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-text-primary underline-offset-4 hover:underline"
            >
              {evidenceLabel(item)}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ))}
        </div>
        <label className="mt-3 grid gap-1 text-xs font-medium text-text-secondary">
          Decision note
          <input
            className="h-10 border border-border-light bg-surface-primary px-3 text-sm text-text-primary outline-none focus:border-border-medium"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={!canDecide || decision.isLoading || !reason.trim()}
          onClick={() => decide('rejected')}
        >
          Reject
        </Button>
        <Button
          disabled={!canDecide || decision.isLoading || !reason.trim()}
          onClick={() => decide('approved')}
        >
          {decision.isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
          Approve
        </Button>
      </div>
    </article>
  );
}

function ActivityView({
  context,
  selectedTask,
  run,
  onSelectTask,
}: {
  context: TStaraEngineeringContext;
  selectedTask: TStaraEngineeringTaskAggregate | null;
  run: TStaraEngineeringRunAggregate | null;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <TaskQueue
        tasks={context.tasks}
        selectedTaskId={selectedTask?.task.id ?? null}
        onSelect={onSelectTask}
      />
      <section className="border border-border-light p-4">
        <div className="border-b border-border-light pb-3">
          <h2 className="text-base font-semibold text-text-primary">Redacted delivery activity</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Commands and provider payloads remain hidden; this view shows durable state and evidence
            references.
          </p>
        </div>
        <div className="mt-4">
          {run ? (
            <div className="grid gap-5">
              <EvidenceStrip events={run.events} />
              <RunTimeline run={run} />
            </div>
          ) : (
            <CenteredState
              icon={<CircleDot className="h-5 w-5" />}
              title="No run activity"
              description="Select a task with a run to inspect its lineage."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function EngineeringSettings({ context }: { context: TStaraEngineeringContext }) {
  return (
    <div className="grid gap-6">
      <WorkspaceSummary context={context} />
      <section className="grid gap-4 border-b border-border-light pb-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Business context</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Shared outcomes and workflows guide task planning and readiness.
          </p>
        </div>
        <BusinessProfileForm context={context} />
      </section>
      <section className="grid gap-4 border-b border-border-light pb-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Repository access</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            GitHub App installation tokens are minted inside the isolated executor. They are never
            stored in the browser.
          </p>
        </div>
        <div className="grid gap-4">
          <RepositoryList context={context} />
          {context.permissions.can_connect_repository ? <RepositoryForm /> : null}
        </div>
      </section>
      <section className="grid gap-4 border-b border-border-light pb-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Delivery policy</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Safe defaults require review, protected merge, and protected deployment.
          </p>
        </div>
        <PolicyForm context={context} />
      </section>
      <section className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Business readiness</h2>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            These checks come from the canonical organization policy and membership state.
          </p>
        </div>
        <ReadinessList context={context} />
      </section>
    </div>
  );
}

function BusinessProfileForm({ context }: { context: TStaraEngineeringContext }) {
  const { showToast } = useToastContext();
  const [businessSummary, setBusinessSummary] = useState('');
  const [primaryOutcomes, setPrimaryOutcomes] = useState('');
  const [criticalWorkflows, setCriticalWorkflows] = useState('');
  const [operatingConstraints, setOperatingConstraints] = useState('');
  const mutation = useUpdateStaraBusinessProfileMutation();
  const loadedProfileVersion = useRef<string | null>(null);

  useEffect(() => {
    const profileVersion = context.business_profile?.updated_at ?? 'missing';
    if (loadedProfileVersion.current === profileVersion) {
      return;
    }
    loadedProfileVersion.current = profileVersion;
    setBusinessSummary(context.business_profile?.business_summary ?? '');
    setPrimaryOutcomes((context.business_profile?.primary_outcomes ?? []).join('\n'));
    setCriticalWorkflows((context.business_profile?.critical_workflows ?? []).join('\n'));
    setOperatingConstraints((context.business_profile?.operating_constraints ?? []).join('\n'));
  }, [context.business_profile]);

  const primaryOutcomeLines = linesFrom(primaryOutcomes);
  const criticalWorkflowLines = linesFrom(criticalWorkflows);
  const canSave =
    context.permissions.can_update_business_profile &&
    businessSummary.trim().length > 0 &&
    primaryOutcomeLines.length > 0 &&
    criticalWorkflowLines.length > 0 &&
    !mutation.isLoading;

  const save = async () => {
    try {
      await mutation.mutateAsync({
        business_summary: businessSummary.trim(),
        primary_outcomes: primaryOutcomeLines,
        critical_workflows: criticalWorkflowLines,
        operating_constraints: linesFrom(operatingConstraints),
      });
      showToast({ message: 'Business context updated.', status: 'success' });
    } catch (error) {
      showToast({ message: errorMessage(error), status: 'error' });
    }
  };

  return (
    <div className="grid gap-4">
      <Field label="Business summary">
        <textarea
          className="min-h-24"
          value={businessSummary}
          onChange={(event) => setBusinessSummary(event.target.value)}
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Primary outcomes" hint="One per line">
          <textarea
            className="min-h-28"
            value={primaryOutcomes}
            onChange={(event) => setPrimaryOutcomes(event.target.value)}
          />
        </Field>
        <Field label="Critical workflows" hint="One per line">
          <textarea
            className="min-h-28"
            value={criticalWorkflows}
            onChange={(event) => setCriticalWorkflows(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Operating constraints" hint="Optional, one per line">
        <textarea
          className="min-h-20"
          value={operatingConstraints}
          onChange={(event) => setOperatingConstraints(event.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Button onClick={save} disabled={!canSave}>
          {mutation.isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
          Save business context
        </Button>
      </div>
    </div>
  );
}

function RepositoryList({ context }: { context: TStaraEngineeringContext }) {
  const [editingRepositoryId, setEditingRepositoryId] = useState<string | null>(null);
  if (context.repositories.length === 0) {
    return <p className="text-sm text-text-secondary">No repositories connected.</p>;
  }
  return (
    <div className="divide-y divide-border-light border-y border-border-light">
      {context.repositories.map((repository) => {
        const editing = repository.id === editingRepositoryId;
        const checkScripts = repository.check_profiles.map((profile) => profile.script).join(', ');
        return (
          <div key={repository.id} className="py-3">
            <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(8rem,14rem)_8rem_2.5rem]">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {repository.repository_owner}/{repository.repository_name}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {repository.default_branch} / installation{' '}
                  {repository.installation_id ?? 'missing'}
                </div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm text-text-secondary" title={checkScripts}>
                  {checkScripts || 'No required checks'}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {repository.check_profiles.length} check profile
                  {repository.check_profiles.length === 1 ? '' : 's'}
                </div>
              </div>
              <StatusBadge status={repository.status} />
              {context.permissions.can_connect_repository ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit checks for ${repository.repository_owner}/${repository.repository_name}`}
                  title="Edit check profiles"
                  onClick={() => setEditingRepositoryId(editing ? null : repository.id)}
                >
                  {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                </Button>
              ) : (
                <span />
              )}
            </div>
            {editing ? (
              <RepositoryCheckProfilesEditor
                repository={repository}
                onClose={() => setEditingRepositoryId(null)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RepositoryCheckProfilesEditor({
  repository,
  onClose,
}: {
  repository: TStaraEngineeringRepository;
  onClose: () => void;
}) {
  const { showToast } = useToastContext();
  const [profiles, setProfiles] = useState(() =>
    repository.check_profiles.map((profile) => ({ ...profile })),
  );
  const mutation = useUpdateStaraEngineeringRepositoryMutation();
  const valid =
    profiles.length <= 20 &&
    profiles.every(
      (profile) =>
        profile.label.trim().length > 0 &&
        profile.script.trim().length > 0 &&
        profile.working_directory.trim().length > 0,
    );

  const addProfile = () => {
    const usedIds = new Set(profiles.map((profile) => profile.profile_id));
    let index = profiles.length + 1;
    let profileId = index === 1 ? 'package-check' : `package-check-${index}`;
    while (usedIds.has(profileId)) {
      index += 1;
      profileId = `package-check-${index}`;
    }
    setProfiles([
      ...profiles,
      {
        profile_id: profileId,
        label: 'Package check',
        runner: 'npm',
        script: '',
        working_directory: '.',
      },
    ]);
  };

  const save = async () => {
    try {
      await mutation.mutateAsync({
        repositoryId: repository.id,
        payload: {
          expected_version: repository.version,
          check_profiles: profiles.map((profile) => ({
            ...profile,
            label: profile.label.trim(),
            script: profile.script.trim(),
            working_directory: profile.working_directory.trim(),
          })),
        },
      });
      showToast({ message: 'Repository checks updated.', status: 'success' });
      onClose();
    } catch (error) {
      showToast({ message: errorMessage(error), status: 'error' });
    }
  };

  return (
    <div className="mt-3 grid gap-3 border-t border-border-light pt-3">
      <div>
        <h3 className="text-sm font-medium text-text-primary">Required npm checks</h3>
        <p className="mt-1 text-xs text-text-secondary">
          Each script runs from its configured repository directory before a pull request can
          advance.
        </p>
      </div>
      {profiles.length === 0 ? (
        <p className="text-sm text-text-secondary">No required npm checks.</p>
      ) : (
        <div className="grid gap-3">
          {profiles.map((profile, index) => (
            <div
              key={profile.profile_id}
              className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_2.5rem]"
            >
              <Field label="Check label">
                <input
                  value={profile.label}
                  onChange={(event) =>
                    setProfiles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="npm script">
                <input
                  value={profile.script}
                  onChange={(event) =>
                    setProfiles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, script: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Working directory">
                <input
                  value={profile.working_directory}
                  onChange={(event) =>
                    setProfiles((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, working_directory: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </Field>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${profile.label || 'check'}`}
                title="Remove check profile"
                onClick={() =>
                  setProfiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={addProfile} disabled={profiles.length >= 20}>
          <Plus className="mr-2 h-4 w-4" />
          Add npm check
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={mutation.isLoading}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || mutation.isLoading}>
            {mutation.isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
            Save checks
          </Button>
        </div>
      </div>
    </div>
  );
}

function RepositoryForm() {
  const { showToast } = useToastContext();
  const [owner, setOwner] = useState('stara-labs');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [installationId, setInstallationId] = useState('');
  const [checkScript, setCheckScript] = useState('check');
  const [projectId, setProjectId] = useState('');
  const [region, setRegion] = useState('us-central1');
  const [serviceName, setServiceName] = useState('');
  const mutation = useCreateStaraEngineeringRepositoryMutation();

  const submit = async () => {
    if (!owner.trim() || !name.trim() || !branch.trim() || !installationId.trim()) {
      showToast({
        message: 'Repository, branch, and GitHub App installation ID are required.',
        status: 'error',
      });
      return;
    }
    if ([projectId, serviceName].some(Boolean) && (!projectId || !region || !serviceName)) {
      showToast({
        message: 'Complete every Cloud Run deployment field or leave all of them blank.',
        status: 'error',
      });
      return;
    }
    const payload: TCreateStaraEngineeringRepositoryRequest = {
      repository_owner: owner.trim(),
      repository_name: name.trim(),
      default_branch: branch.trim(),
      installation_id: installationId.trim(),
      check_profiles: checkScript.trim()
        ? [
            {
              profile_id: 'package-check',
              label: 'Package check',
              runner: 'npm',
              script: checkScript.trim(),
              working_directory: '.',
            },
          ]
        : [],
      ...(projectId && serviceName
        ? {
            deployment_target: {
              provider: 'cloud_run' as const,
              project_id: projectId.trim(),
              region: region.trim(),
              service_name: serviceName.trim(),
            },
          }
        : {}),
      activate: true,
    };
    try {
      await mutation.mutateAsync(payload);
      setName('');
      setInstallationId('');
      setProjectId('');
      setServiceName('');
      showToast({ message: 'Repository connected.', status: 'success' });
    } catch (error) {
      showToast({ message: errorMessage(error), status: 'error' });
    }
  };

  return (
    <div className="grid gap-4 border-t border-border-light pt-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="GitHub owner">
          <input value={owner} onChange={(event) => setOwner(event.target.value)} />
        </Field>
        <Field label="Repository">
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Default branch">
          <input value={branch} onChange={(event) => setBranch(event.target.value)} />
        </Field>
        <Field label="Installation ID">
          <input
            inputMode="numeric"
            value={installationId}
            onChange={(event) => setInstallationId(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Required npm script" hint="Leave blank only for documentation repositories">
        <input value={checkScript} onChange={(event) => setCheckScript(event.target.value)} />
      </Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Cloud project" hint="Optional deployment target">
          <input value={projectId} onChange={(event) => setProjectId(event.target.value)} />
        </Field>
        <Field label="Region">
          <input value={region} onChange={(event) => setRegion(event.target.value)} />
        </Field>
        <Field label="Cloud Run service">
          <input value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={mutation.isLoading}>
          {mutation.isLoading ? (
            <Spinner className="mr-2 h-4 w-4" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Connect repository
        </Button>
      </div>
    </div>
  );
}

function PolicyForm({ context }: { context: TStaraEngineeringContext }) {
  const { showToast } = useToastContext();
  const delivery = context.policy_config?.engineering_delivery;
  const [mergeApproval, setMergeApproval] = useState(delivery?.merge_approval_required ?? true);
  const [deploymentApproval, setDeploymentApproval] = useState(
    delivery?.deployment_approval_required ?? true,
  );
  const [mergeApproverRoles, setMergeApproverRoles] = useState<StaraEngineeringApproverRoleKey[]>(
    delivery?.merge_approver_role_keys ?? ['owner', 'admin'],
  );
  const [deploymentApproverRoles, setDeploymentApproverRoles] = useState<
    StaraEngineeringApproverRoleKey[]
  >(delivery?.deployment_approver_role_keys ?? ['owner', 'admin']);
  const [draftPullRequest, setDraftPullRequest] = useState(delivery?.pull_request_draft ?? true);
  const [maxRepairs, setMaxRepairs] = useState(delivery?.max_repair_attempts ?? 5);
  const [branchPrefix, setBranchPrefix] = useState(delivery?.branch_prefix ?? 'stara');
  const [checks, setChecks] = useState((delivery?.required_ci_check_names ?? []).join('\n'));
  const mutation = useUpdateStaraEngineeringPolicyMutation();
  const loadedPolicyVersion = useRef<string | null>(null);

  useEffect(() => {
    const policyVersion = context.policy_config?.updated_at ?? null;
    if (!delivery || loadedPolicyVersion.current === policyVersion) {
      return;
    }
    loadedPolicyVersion.current = policyVersion;
    setMergeApproval(delivery.merge_approval_required);
    setDeploymentApproval(delivery.deployment_approval_required);
    setMergeApproverRoles(delivery.merge_approver_role_keys ?? ['owner', 'admin']);
    setDeploymentApproverRoles(delivery.deployment_approver_role_keys ?? ['owner', 'admin']);
    setDraftPullRequest(delivery.pull_request_draft);
    setMaxRepairs(delivery.max_repair_attempts);
    setBranchPrefix(delivery.branch_prefix);
    setChecks(delivery.required_ci_check_names.join('\n'));
  }, [context.policy_config?.updated_at, delivery]);

  if (!delivery) {
    return <p className="text-sm text-text-secondary">Organization policy is unavailable.</p>;
  }

  const save = async () => {
    try {
      await mutation.mutateAsync({
        template_key: 'custom',
        engineering_delivery: {
          ...delivery,
          merge_approval_required: mergeApproval,
          deployment_approval_required: deploymentApproval,
          merge_approver_role_keys: mergeApproverRoles,
          deployment_approver_role_keys: deploymentApproverRoles,
          pull_request_draft: draftPullRequest,
          max_repair_attempts: maxRepairs,
          branch_prefix: branchPrefix.trim(),
          required_ci_check_names: checks
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      showToast({ message: 'Delivery policy updated.', status: 'success' });
    } catch (error) {
      showToast({ message: errorMessage(error), status: 'error' });
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <ToggleRow label="Merge approval" checked={mergeApproval} onChange={setMergeApproval} />
        <ToggleRow
          label="Deployment approval"
          checked={deploymentApproval}
          onChange={setDeploymentApproval}
        />
        <ToggleRow
          label="Open pull requests as draft"
          checked={draftPullRequest}
          onChange={setDraftPullRequest}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ApproverRoleSelector
          label="Merge approvers"
          selected={mergeApproverRoles}
          onChange={setMergeApproverRoles}
        />
        <ApproverRoleSelector
          label="Deployment approvers"
          selected={deploymentApproverRoles}
          onChange={setDeploymentApproverRoles}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Branch prefix">
          <input value={branchPrefix} onChange={(event) => setBranchPrefix(event.target.value)} />
        </Field>
        <Field label="Maximum repair attempts">
          <input
            type="number"
            min={0}
            max={20}
            value={maxRepairs}
            onChange={(event) => setMaxRepairs(Number(event.target.value))}
          />
        </Field>
      </div>
      <Field label="Required CI checks" hint="One exact GitHub check name per line">
        <textarea
          className="min-h-24"
          value={checks}
          onChange={(event) => setChecks(event.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={!context.permissions.can_update_policy || mutation.isLoading}
        >
          {mutation.isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
          Save policy
        </Button>
      </div>
    </div>
  );
}

function ApproverRoleSelector({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: StaraEngineeringApproverRoleKey[];
  onChange: (roles: StaraEngineeringApproverRoleKey[]) => void;
}) {
  const toggle = (role: StaraEngineeringApproverRoleKey, checked: boolean) => {
    if (checked) {
      onChange([...new Set([...selected, role])]);
      return;
    }
    if (selected.length > 1) {
      onChange(selected.filter((candidate) => candidate !== role));
    }
  };

  return (
    <fieldset className="grid gap-2 border border-border-light p-3">
      <legend className="px-1 text-sm font-medium text-text-primary">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(['owner', 'admin'] as const).map((role) => {
          const checked = selected.includes(role);
          return (
            <label
              key={role}
              className="flex min-h-10 items-center gap-2 text-sm capitalize text-text-primary"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={checked && selected.length === 1}
                onChange={(event) => toggle(role, event.target.checked)}
              />
              {role}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ReadinessList({ context }: { context: TStaraEngineeringContext }) {
  const readiness = context.readiness;
  if (!readiness) {
    return <p className="text-sm text-text-secondary">Readiness is unavailable.</p>;
  }
  return (
    <div className="divide-y divide-border-light border-y border-border-light">
      {readiness.checks.map((check) => (
        <div key={check.check_id} className="flex items-start gap-3 py-3">
          {check.status === 'pass' ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
          )}
          <div>
            <div className="text-sm font-medium text-text-primary">{humanize(check.check_id)}</div>
            <div className="mt-1 text-sm text-text-secondary">{check.summary}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 border border-border-light px-3 text-sm text-text-primary">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-text-primary [&_input]:h-10 [&_input]:min-w-0 [&_input]:border [&_input]:border-border-light [&_input]:bg-surface-primary [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input]:focus:border-border-medium [&_select]:h-10 [&_select]:min-w-0 [&_select]:border [&_select]:border-border-light [&_select]:bg-surface-primary [&_select]:px-3 [&_select]:text-sm [&_textarea]:min-w-0 [&_textarea]:resize-y [&_textarea]:border [&_textarea]:border-border-light [&_textarea]:bg-surface-primary [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm [&_textarea]:leading-6 [&_textarea]:outline-none [&_textarea]:focus:border-border-medium">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span>{label}</span>
        {hint ? <span className="text-xs font-normal text-text-secondary">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function InlineNotice({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-y border-border-light py-3">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
        <div>
          <div className="text-sm font-medium text-text-primary">{title}</div>
          <div className="mt-1 text-sm leading-6 text-text-secondary">{description}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

function CenteredState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-72 items-center justify-center border border-border-light p-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-9 w-9 items-center justify-center border border-border-light bg-surface-secondary">
          {icon}
        </div>
        <h2 className="mt-3 text-base font-semibold text-text-primary">{title}</h2>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p>
        ) : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

function StatusText({ status }: { status: string }) {
  return <span className="truncate">{humanize(status)}</span>;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex h-7 w-fit items-center border border-border-light bg-surface-secondary px-2 text-xs font-medium text-text-primary">
      {humanize(status)}
    </span>
  );
}

function uniqueEvidence(items: TStaraEngineeringEvidenceReference[]) {
  return [
    ...new Map(items.map((item) => [`${item.evidence_type}:${item.external_id}`, item])).values(),
  ];
}

function approvalEvidence(approval: TStaraEngineeringApproval) {
  const value = approval.summary_redacted.evidence_refs;
  return Array.isArray(value)
    ? (value.filter((item): item is TStaraEngineeringEvidenceReference =>
        Boolean(
          item &&
            typeof item === 'object' &&
            'evidence_type' in item &&
            'external_id' in item &&
            'url' in item,
        ),
      ) as TStaraEngineeringEvidenceReference[])
    : [];
}

function approvalSummary(approval: TStaraEngineeringApproval) {
  const summary = approval.summary_redacted.summary;
  return typeof summary === 'string'
    ? summary
    : `${humanize(approval.target)} requires ${approval.required_role_keys.join(' or ')} approval.`;
}

function evidenceLabel(evidence: TStaraEngineeringEvidenceReference) {
  let prefix = humanize(evidence.evidence_type);
  if (evidence.evidence_type === 'pull_request') {
    prefix = 'PR';
  } else if (evidence.evidence_type === 'check_run') {
    prefix = 'Check';
  } else if (evidence.evidence_type === 'deployment') {
    prefix = 'Deploy';
  }
  return `${prefix} ${evidence.external_id}`;
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Unknown'
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
}

function operationKey(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`.slice(0, 256);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The engineering operation failed.';
}
