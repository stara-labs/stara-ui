import { useEffect } from 'react';
import { Spinner } from '@librechat/client';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useStaraOnboardingContextQuery } from '~/data-provider';

export default function StaraOnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isOnboardingRoute = location.pathname.replace(/\/+$/, '') === '/onboarding';
  const { data, isLoading } = useStaraOnboardingContextQuery({
    enabled: !isOnboardingRoute,
  });
  const requiresOnboarding = Boolean(data?.requiresOnboarding || data?.requiresTenantAddendum);

  useEffect(() => {
    if (isOnboardingRoute || !data || !requiresOnboarding) {
      return;
    }
    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    navigate(`/onboarding?mode=required&redirect_to=${encodeURIComponent(currentPath)}`, {
      replace: true,
    });
  }, [
    data,
    isOnboardingRoute,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    requiresOnboarding,
  ]);

  if (isOnboardingRoute) {
    return <>{children}</>;
  }

  if (isLoading || requiresOnboarding) {
    return (
      <div className="flex h-full items-center justify-center bg-presentation text-text-primary">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  return <>{children}</>;
}
