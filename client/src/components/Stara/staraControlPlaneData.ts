import { Activity, GitPullRequest, Network, Settings2, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type StaraSectionId = 'workflows' | 'approvals' | 'activity' | 'organization' | 'settings';

export type StaraSection = {
  id: StaraSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const staraSections: StaraSection[] = [
  {
    id: 'workflows',
    label: 'Workflows',
    description: 'Create scoped work and follow checks, pull requests, and deployments.',
    icon: GitPullRequest,
  },
  {
    id: 'approvals',
    label: 'Approvals',
    description: 'Review version-bound merge and deployment decisions.',
    icon: ShieldCheck,
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Inspect redacted run history and external evidence references.',
    icon: Activity,
  },
  {
    id: 'organization',
    label: 'Organization',
    description: 'Manage canonical membership, teams, and agent access.',
    icon: Network,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Configure repositories, delivery policy, and business readiness.',
    icon: Settings2,
  },
];

export const staraSectionIds = staraSections.map((section) => section.id);

export const staraSectionAliases: Record<string, StaraSectionId> = {
  launcher: 'workflows',
  recipes: 'workflows',
  heartbeat: 'workflows',
  agents: 'workflows',
  context: 'activity',
  memory: 'activity',
  vault: 'activity',
  objects: 'activity',
  tools: 'activity',
  routes: 'activity',
  'route-summary': 'activity',
  observability: 'activity',
  'trace-summary': 'activity',
};

export function resolveStaraSectionId(section?: string): StaraSectionId | undefined {
  if (!section) {
    return undefined;
  }
  if (staraSectionIds.includes(section as StaraSectionId)) {
    return section as StaraSectionId;
  }
  return staraSectionAliases[section];
}

export const staraPanelCopy = {
  title: 'Stara',
  subtitle: 'Control plane',
};
