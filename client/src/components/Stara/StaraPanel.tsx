import { NavLink as RouterNavLink } from 'react-router-dom';
import { staraPanelCopy, staraSections } from './staraControlPlaneData';
import { cn } from '~/utils';

export default function StaraPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border-light px-4 py-3">
        <div className="text-sm font-semibold text-text-primary">{staraPanelCopy.title}</div>
        <div className="mt-1 text-xs leading-5 text-text-secondary">{staraPanelCopy.subtitle}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {staraSections.map((section) => {
          const Icon = section.icon;
          return (
            <RouterNavLink
              key={section.id}
              to={`/stara/${section.id}`}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                  isActive
                    ? 'bg-surface-active-alt text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{section.label}</span>
                <span className="block truncate text-xs opacity-80">{section.status}</span>
              </span>
            </RouterNavLink>
          );
        })}
      </div>
    </div>
  );
}
