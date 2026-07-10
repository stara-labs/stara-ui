import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { NavLink as RouterNavLink, Navigate, useParams } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useDocumentTitle } from '~/hooks';
import { cn } from '~/utils';
import {
  graphLinks,
  graphNodes,
  heartbeatRows,
  memoryCandidates,
  routeRows,
  settingsRows,
  staraSectionIds,
  staraSections,
  toolRows,
  type StaraSectionId,
} from './staraControlPlaneData';

export default function StaraControlPlaneView() {
  const { section } = useParams();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const activeSection = useMemo(() => staraSections.find((item) => item.id === section), [section]);

  useDocumentTitle('Stara Control Plane | Stara');

  if (!section) {
    return <Navigate to="/stara/memory" replace />;
  }

  if (!staraSectionIds.includes(section as StaraSectionId) || !activeSection) {
    return <Navigate to="/stara/memory" replace />;
  }

  const Icon = activeSection.icon;

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-presentation text-text-primary">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
          <header className="flex flex-col gap-4 border-b border-border-light pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {isSmallScreen ? <OpenSidebar /> : null}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-secondary">
                  <Icon className="h-5 w-5 text-text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold tracking-tight text-text-primary md:text-2xl">
                    {activeSection.label}
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">
                    {activeSection.description}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm">
                <span className="rounded-md border border-border-light bg-surface-secondary px-3 py-2 font-medium text-text-primary">
                  {activeSection.metric}
                </span>
                <span className="rounded-md border border-border-light bg-surface-primary px-3 py-2 text-text-secondary">
                  {activeSection.status}
                </span>
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="Stara sections">
              {staraSections.map((item) => (
                <RouterNavLink
                  key={item.id}
                  to={`/stara/${item.id}`}
                  className={({ isActive }) =>
                    cn(
                      'whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-surface-active-alt text-text-primary'
                        : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                    )
                  }
                >
                  {item.label}
                </RouterNavLink>
              ))}
            </nav>
          </header>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              <SectionContent sectionId={activeSection.id} />
            </div>
            <aside className="flex min-w-0 flex-col gap-3">
              <StatusRail />
            </aside>
          </section>
        </div>
      </div>
    </main>
  );
}

function SectionContent({ sectionId }: { sectionId: StaraSectionId }) {
  if (sectionId === 'memory') {
    return <MemorySection />;
  }
  if (sectionId === 'tools') {
    return <ToolsSection />;
  }
  if (sectionId === 'heartbeat') {
    return <HeartbeatSection />;
  }
  if (sectionId === 'routes') {
    return <RoutesSection />;
  }
  if (sectionId === 'settings') {
    return <SettingsSection />;
  }
  if (sectionId === 'approvals') {
    return <ApprovalsSection />;
  }
  return <GenericSection sectionId={sectionId} />;
}

function MemorySection() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Panel title="Memory Review" eyebrow="Promotion queue">
        <div className="divide-y divide-border-light">
          {memoryCandidates.map((candidate) => (
            <div key={candidate.id} className="grid gap-2 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text-primary">{candidate.layer}</span>
                <span className="rounded-md bg-surface-active-alt px-2 py-1 text-xs font-medium text-text-primary">
                  {candidate.status}
                </span>
              </div>
              <p className="text-sm leading-6 text-text-secondary">{candidate.statement}</p>
              <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
                <span>Confidence {candidate.confidence}</span>
                <span>Impact {candidate.impact}</span>
                <span>{candidate.id}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Source Graph" eyebrow="Evidence projection">
        <MemorySourceGraph />
      </Panel>
    </div>
  );
}

function MemorySourceGraph() {
  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));

  return (
    <div className="min-w-0">
      <svg
        viewBox="0 0 420 280"
        role="img"
        aria-label="Memory source graph"
        className="h-72 w-full rounded-lg border border-border-light bg-surface-primary"
      >
        {/* Phase 4 seeds deterministic coordinates; Phase 7 can replace this with a live force simulation. */}
        {graphLinks.map(([source, target]) => {
          const left = nodeById.get(source);
          const right = nodeById.get(target);
          if (!left || !right) {
            return null;
          }
          return (
            <line
              key={`${source}-${target}`}
              x1={left.x}
              y1={left.y}
              x2={right.x}
              y2={right.y}
              stroke="currentColor"
              strokeOpacity="0.22"
              strokeWidth="1.5"
              className="text-text-secondary"
            />
          );
        })}
        {graphNodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={node.kind === 'Memory' ? 22 : 17}
              className={cn(
                'stroke-border-heavy',
                node.kind === 'Memory' ? 'fill-surface-active-alt' : 'fill-surface-secondary',
              )}
              strokeWidth="1.5"
            />
            <text
              x={node.x}
              y={node.y + 34}
              textAnchor="middle"
              className="fill-text-secondary text-[10px] font-medium"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function ToolsSection() {
  return (
    <Panel title="Granted MCP Tools" eyebrow="Discoverable through Stara MCP">
      <DataTable
        columns={['Tool', 'Group', 'Scope', 'Status']}
        rows={toolRows}
        getStatusClass={(value) =>
          value === 'Pending service'
            ? 'bg-surface-secondary text-text-secondary'
            : 'bg-surface-active-alt text-text-primary'
        }
      />
    </Panel>
  );
}

function HeartbeatSection() {
  return (
    <Panel title="Workflow Heartbeat" eyebrow="Human and agent work status">
      <DataTable
        columns={['Lane', 'Status', 'Updated', 'Signal']}
        rows={heartbeatRows}
        getStatusClass={(value) =>
          value === 'Attention'
            ? 'bg-red-500/10 text-red-600 dark:text-red-300'
            : 'bg-surface-active-alt text-text-primary'
        }
      />
    </Panel>
  );
}

function RoutesSection() {
  return (
    <Panel title="Route And Cost Summary" eyebrow="Policy-routed model movement">
      <DataTable columns={['Route', 'Share', 'Cost', 'Reason']} rows={routeRows} />
    </Panel>
  );
}

function SettingsSection() {
  return (
    <Panel title="Governance Settings" eyebrow="Tenant defaults">
      <div className="grid gap-3">
        {settingsRows.map(([label, status, Icon]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-primary px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="truncate text-sm font-medium text-text-primary">{label}</span>
            </span>
            <span className="shrink-0 text-sm text-text-secondary">{status}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ApprovalsSection() {
  return (
    <Panel title="Approval Packets" eyebrow="Owner review">
      <DataTable
        columns={['Packet', 'Type', 'Owner', 'State']}
        rows={[
          ['appr-3201', 'Company memory', 'Org owner', 'Needs review'],
          ['appr-3202', 'Generated tool', 'Team lead', 'Evidence check'],
          ['appr-3203', 'Route exception', 'Admin', 'Policy hold'],
        ]}
      />
    </Panel>
  );
}

function GenericSection({ sectionId }: { sectionId: StaraSectionId }) {
  const section = staraSections.find((item) => item.id === sectionId)!;
  return (
    <Panel title={`${section.label} Detail`} eyebrow="Seeded V1 surface">
      <div className="grid gap-3 md:grid-cols-3">
        {['Canonical state', 'MCP projection', 'Review state'].map((label, index) => (
          <div
            key={label}
            className="min-h-32 rounded-lg border border-border-light bg-surface-primary p-4"
          >
            <div className="text-sm font-semibold text-text-primary">{label}</div>
            <div className="mt-6 text-2xl font-semibold text-text-primary">
              {index === 0 ? section.metric : index === 1 ? section.status : 'Ready'}
            </div>
            <div className="mt-2 text-sm leading-6 text-text-secondary">{section.description}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StatusRail() {
  return (
    <>
      <Panel title="V1 Readiness" eyebrow="Control plane">
        <div className="grid gap-3">
          {staraSections.slice(0, 6).map((section) => (
            <div key={section.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-text-secondary">{section.label}</span>
              <span className="shrink-0 font-medium text-text-primary">{section.status}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Policy Envelope" eyebrow="Every request">
        <div className="grid gap-2 text-sm text-text-secondary">
          <span>Tenant resolved</span>
          <span>Actor scoped</span>
          <span>Memory versioned</span>
          <span>Response projected</span>
          <span>Observation redacted</span>
        </div>
      </Panel>
    </>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-light bg-surface-secondary p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-normal text-text-secondary">
            {eyebrow}
          </div>
          <h2 className="mt-1 text-base font-semibold text-text-primary">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function DataTable({
  columns,
  rows,
  getStatusClass,
}: {
  columns: string[];
  rows: string[][];
  getStatusClass?: (value: string) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b border-border-light px-3 py-2 text-text-secondary"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('-')}>
              {row.map((cell, index) => (
                <td key={cell} className="border-b border-border-light px-3 py-3 text-text-primary">
                  {index === row.length - 1 && getStatusClass ? (
                    <span
                      className={cn(
                        'rounded-md px-2 py-1 text-xs font-medium',
                        getStatusClass(cell),
                      )}
                    >
                      {cell}
                    </span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
