import { useMemo } from 'react';
import { useMediaQuery } from '@librechat/client';
import { NavLink as RouterNavLink, Navigate, useParams } from 'react-router-dom';
import {
  resolveStaraSectionId,
  staraSectionIds,
  staraSections,
  type StaraSectionId,
} from './staraControlPlaneData';
import StaraEngineeringWorkspace from './StaraEngineeringWorkspace';
import StaraOrganizationControl from './StaraOrganizationControl';
import { useStaraEngineeringContextQuery } from '~/data-provider';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { useDocumentTitle } from '~/hooks';
import { cn } from '~/utils';

export default function StaraControlPlaneView() {
  const { section } = useParams();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const resolvedSectionId = useMemo(() => resolveStaraSectionId(section), [section]);
  const activeSection = useMemo(
    () => staraSections.find((item) => item.id === resolvedSectionId),
    [resolvedSectionId],
  );
  const engineeringQuery = useStaraEngineeringContextQuery({
    enabled: resolvedSectionId !== 'organization',
  });

  useDocumentTitle('Stara Control Plane | Stara');

  if (!section) {
    return <Navigate to="/stara/workflows" replace />;
  }
  if (!resolvedSectionId || !staraSectionIds.includes(resolvedSectionId) || !activeSection) {
    return <Navigate to="/stara/workflows" replace />;
  }
  if (resolvedSectionId !== section) {
    return <Navigate to={`/stara/${resolvedSectionId}`} replace />;
  }
  if (
    resolvedSectionId !== 'organization' &&
    (!engineeringQuery.data || !engineeringQuery.data.platform_engineering_access)
  ) {
    if (engineeringQuery.isLoading) {
      return null;
    }
    return <Navigate to="/stara/organization" replace />;
  }

  const Icon = activeSection.icon;

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-presentation text-text-primary">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
          <header className="flex flex-col gap-4 border-b border-border-light pb-5">
            <div className="flex min-w-0 items-start gap-3">
              {isSmallScreen ? <OpenSidebar /> : null}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border-light bg-surface-secondary">
                <Icon className="h-5 w-5 text-text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight text-text-primary md:text-2xl">
                  {activeSection.label}
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">
                  {activeSection.description}
                </p>
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="Stara sections">
              {staraSections
                .filter(
                  (item) =>
                    item.id === 'organization' ||
                    engineeringQuery.data?.platform_engineering_access,
                )
                .map((item) => (
                  <RouterNavLink
                    key={item.id}
                    to={`/stara/${item.id}`}
                    className={({ isActive }) =>
                      cn(
                        'whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'border-b-2 border-text-primary text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                      )
                    }
                  >
                    {item.label}
                  </RouterNavLink>
                ))}
            </nav>
          </header>

          <section className="min-w-0 flex-1">
            <SectionContent sectionId={activeSection.id} />
          </section>
        </div>
      </div>
    </main>
  );
}

function SectionContent({ sectionId }: { sectionId: StaraSectionId }) {
  if (sectionId === 'organization') {
    return <StaraOrganizationControl />;
  }
  return <StaraEngineeringWorkspace view={sectionId} />;
}
