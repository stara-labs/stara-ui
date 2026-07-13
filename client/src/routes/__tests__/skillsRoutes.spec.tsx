import React from 'react';
import { matchRoutes } from 'react-router-dom';

jest.mock('~/components/Auth', () => ({
  Login: () => null,
  VerifyEmail: () => null,
  Registration: () => null,
  ResetPassword: () => null,
  ApiErrorWatcher: () => null,
  TwoFactorScreen: () => null,
  IdentityPlatformMfaSetup: () => null,
  RequestPasswordReset: () => null,
}));

jest.mock('~/components/Agents/MarketplaceContext', () => ({
  MarketplaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('~/components/Agents/Marketplace', () => () => null);
jest.mock('~/components/OAuth', () => ({
  OAuthSuccess: () => null,
  OAuthError: () => null,
}));
jest.mock('~/hooks/AuthContext', () => ({
  AuthContextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../RouteErrorBoundary', () => () => null);
jest.mock('../Layouts/Startup', () => () => null);
jest.mock('../Layouts/Login', () => () => null);
jest.mock('../Dashboard', () => ({
  __esModule: true,
  default: { path: 'dashboard', element: null },
}));
jest.mock('../ShareRoute', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../ChatRoute', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../Search', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../Root', () => ({
  __esModule: true,
  default: () => null,
}));

import { router } from '../index';
import { staraSections } from '~/components/Stara/staraControlPlaneData';

type RouteNode = {
  path?: string;
  children?: RouteNode[];
};

// The route table is easier to validate directly than by rendering the full app
// shell, which would pull in auth, startup, and dashboard side effects.
function flattenPaths(routes: RouteNode[]): string[] {
  return routes.flatMap((route) => [
    ...(route.path ? [route.path] : []),
    ...(route.children ? flattenPaths(route.children) : []),
  ]);
}

describe('skills routes', () => {
  it('registers the explicit /skills/new route', () => {
    const paths = flattenPaths((router as unknown as { routes: RouteNode[] }).routes);

    expect(paths).toContain('skills/new');
  });

  it('registers Stara control plane routes', () => {
    const routes = (router as unknown as { routes: RouteNode[] }).routes;
    const paths = flattenPaths(routes);

    expect(paths).toContain('stara');
    expect(paths).toContain('stara/:section');
    staraSections.forEach((section) => {
      expect(paths).not.toContain(`stara/${section.id}`);
      const matches = matchRoutes(routes, `/stara/${section.id}`);
      expect(matches?.at(-1)?.route.path).toBe('stara/:section');
    });
  });
});
