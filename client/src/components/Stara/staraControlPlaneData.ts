import {
  Activity,
  Archive,
  Bot,
  Brain,
  CheckCircle2,
  Database,
  FileClock,
  GitBranch,
  KeyRound,
  ListChecks,
  Network,
  Route,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type StaraSectionId =
  | 'memory'
  | 'organization'
  | 'vault'
  | 'objects'
  | 'tools'
  | 'agents'
  | 'recipes'
  | 'heartbeat'
  | 'approvals'
  | 'routes'
  | 'observability'
  | 'settings';

export type StaraSection = {
  id: StaraSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  metric: string;
  status: string;
};

// Phase 4 keeps these rows local and deterministic so the shell can be reviewed
// before the backing Stara services exist. Later phases should replace the data
// source through typed adapters while preserving these section contracts.
export const staraSections: StaraSection[] = [
  {
    id: 'memory',
    label: 'Memory',
    description: 'User, team, and company knowledge with reviewable provenance.',
    icon: Brain,
    metric: '128 nodes',
    status: 'Reviewing',
  },
  {
    id: 'organization',
    label: 'Organization',
    description: 'Org chart, team membership, and team-to-agent assignments.',
    icon: Network,
    metric: 'Live org',
    status: 'Operational',
  },
  {
    id: 'vault',
    label: 'Vault',
    description: 'Governed secrets, attachments, and protected source references.',
    icon: Archive,
    metric: '42 refs',
    status: 'Synced',
  },
  {
    id: 'objects',
    label: 'Objects',
    description: 'Normalized artifacts, chunks, templates, and governed entities.',
    icon: Database,
    metric: '314 objects',
    status: 'Indexed',
  },
  {
    id: 'tools',
    label: 'Tools',
    description: 'Static and generated MCP tools granted to the current actor.',
    icon: Wrench,
    metric: '18 granted',
    status: 'Available',
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Curated agents, access grants, and control-plane readiness.',
    icon: Bot,
    metric: '9 curated',
    status: 'Seeded',
  },
  {
    id: 'recipes',
    label: 'Recipes',
    description: 'Drafted workflows, approved templates, and recipe runs.',
    icon: Sparkles,
    metric: '6 drafts',
    status: 'Drafting',
  },
  {
    id: 'heartbeat',
    label: 'Heartbeat',
    description: 'Workflow lanes, blockers, handoffs, and agent status.',
    icon: Activity,
    metric: '4 lanes',
    status: 'Live',
  },
  {
    id: 'approvals',
    label: 'Approvals',
    description: 'Human review packets for memory, policy, route, and action changes.',
    icon: ListChecks,
    metric: '7 pending',
    status: 'Queued',
  },
  {
    id: 'routes',
    label: 'Routes',
    description: 'Policy-approved model routes, costs, confidence, and fallbacks.',
    icon: Route,
    metric: '$18.42',
    status: 'Tracing',
  },
  {
    id: 'observability',
    label: 'Observability',
    description: 'Redacted traces, quality signals, confidence, and feedback.',
    icon: GitBranch,
    metric: '92 traces',
    status: 'Redacted',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Tenant, team, source, retention, provider, and policy controls.',
    icon: Settings2,
    metric: '11 checks',
    status: 'Configured',
  },
];

export const staraSectionIds = staraSections.map((section) => section.id);

export const memoryCandidates = [
  {
    id: 'mpc-1042',
    layer: 'Team',
    statement: 'Operations approvers prefer workflow blockers first in summaries.',
    confidence: '0.86',
    impact: 'Medium',
    status: 'Ready for owner review',
  },
  {
    id: 'mpc-1043',
    layer: 'Actor',
    statement: 'User prefers concise route/cost explanations unless risk is high.',
    confidence: '0.91',
    impact: 'Low',
    status: 'Auto-promotable',
  },
  {
    id: 'mpc-1044',
    layer: 'Company',
    statement: 'Approved templates must be referenced before generated workflow output.',
    confidence: '0.78',
    impact: 'High',
    status: 'Needs approval',
  },
];

export const memoryCandidateMetricLabels = {
  confidence: 'Confidence',
  impact: 'Impact',
};

// Stable coordinates make the Obsidian-style source graph reviewable in PR
// screenshots. Phase 7 can swap this fixture for a live force-directed layout.
export const graphNodes = [
  { id: 'chat', label: 'Chat capture', x: 62, y: 72, kind: 'Source' },
  { id: 'drive', label: 'Drive sync', x: 170, y: 44, kind: 'Source' },
  { id: 'memory', label: 'Team memory', x: 285, y: 100, kind: 'Memory' },
  { id: 'template', label: 'Approved template', x: 196, y: 174, kind: 'Object' },
  { id: 'tool', label: 'Generated MCP tool', x: 342, y: 210, kind: 'Tool' },
  { id: 'route', label: 'Route summary', x: 96, y: 228, kind: 'Trace' },
];

export const graphLinks = [
  ['chat', 'memory'],
  ['drive', 'memory'],
  ['memory', 'template'],
  ['memory', 'tool'],
  ['template', 'route'],
  ['tool', 'route'],
] as const;

export const toolRows = [
  ['stara_memory_team_workflow_search', 'Memory', 'Team scope', 'Active'],
  ['stara_context_customer_policy_lookup', 'Context', 'Org scope', 'Generated'],
  ['stara_recipe_draft_from_conversation', 'Recipes', 'Actor scope', 'V1 batch'],
  ['stara_route_cost_summary', 'Routes', 'Admin view', 'Pending service'],
];

export const heartbeatRows = [
  ['Capture', 'Normal', '12 min ago', 'Slack and chat events are current'],
  ['Memory review', 'Attention', '7 pending', 'High-impact candidates need owner review'],
  ['Recipe runs', 'Normal', '3 active', 'No blocked handoffs'],
  ['Projection rebuild', 'Normal', '02:20 UTC', 'Redis/Valkey projections are fresh'],
];

export const routeRows = [
  ['Memory direct', '62%', '$0.00', 'High confidence'],
  ['Secure inference', '27%', '$4.18', 'Sensitive context'],
  ['Approved frontier', '9%', '$14.24', 'Low sensitivity'],
  ['Review required', '2%', '$0.00', 'Policy hold'],
];

export const settingsRows: Array<[string, string, LucideIcon]> = [
  ['Tenant scope resolver', 'Configured', ShieldCheck],
  ['Generated MCP discovery', 'Enabled', Network],
  ['Owner approval rules', 'Required for shared memory', CheckCircle2],
  ['Retention tombstones', 'Resurrection allowed', FileClock],
  ['Provider movement policy', 'Fail closed', KeyRound],
];

export const staraPanelCopy = {
  title: 'Stara',
  subtitle: 'Control plane',
};

export const policyEnvelopeRows = [
  'Tenant resolved',
  'Actor scoped',
  'Memory versioned',
  'Response projected',
  'Observation redacted',
];
