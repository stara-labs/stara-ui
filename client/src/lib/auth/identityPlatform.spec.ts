const mockGetApps = jest.fn();
const mockInitializeApp = jest.fn();
const mockGetAuth = jest.fn();
const mockConnectAuthEmulator = jest.fn();
const mockGetMultiFactorResolver = jest.fn();
const mockOnIdTokenChanged = jest.fn();
const mockSignInWithEmailAndPassword = jest.fn();
const mockSignOut = jest.fn();
const mockAssertionForSignIn = jest.fn();

jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code?: string;
  },
  getApps: (...args: unknown[]) => mockGetApps(...args),
  initializeApp: (...args: unknown[]) => mockInitializeApp(...args),
}));

jest.mock('firebase/auth', () => ({
  connectAuthEmulator: (...args: unknown[]) => mockConnectAuthEmulator(...args),
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  getMultiFactorResolver: (...args: unknown[]) => mockGetMultiFactorResolver(...args),
  onIdTokenChanged: (...args: unknown[]) => mockOnIdTokenChanged(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignInWithEmailAndPassword(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  TotpMultiFactorGenerator: {
    FACTOR_ID: 'totp',
    assertionForSignIn: (...args: unknown[]) => mockAssertionForSignIn(...args),
  },
}));

import {
  completeIdentityPlatformMfa,
  getIdentityPlatformAuth,
  identityPlatformErrorMessage,
  refreshIdentityPlatformToken,
  signInToIdentityPlatform,
  signOutFromIdentityPlatform,
  subscribeToIdentityPlatform,
} from './identityPlatform';
import type { TIdentityPlatformStartupConfig } from 'librechat-data-provider';

const config: TIdentityPlatformStartupConfig = {
  enabled: true,
  apiKey: 'public-key',
  authDomain: 'stara.example.test',
  projectId: 'stara-test',
  tenantId: 'workforce-tenant',
  appId: 'browser-app',
  emulatorUrl: 'http://127.0.0.1:9099',
};

const auth = {
  tenantId: null as string | null,
  currentUser: null as null | { getIdToken: jest.Mock },
};

describe('Identity Platform browser adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetApps.mockReturnValue([]);
    mockInitializeApp.mockReturnValue({ name: 'stara-identity-platform' });
    mockGetAuth.mockReturnValue(auth);
    mockSignInWithEmailAndPassword.mockResolvedValue({ user: {} });
    mockSignOut.mockResolvedValue(undefined);
    auth.currentUser = null;
  });

  it('initializes the named app, tenant, and local emulator', async () => {
    await expect(getIdentityPlatformAuth(config)).resolves.toBe(auth);

    expect(mockInitializeApp).toHaveBeenCalledWith(
      {
        apiKey: 'public-key',
        authDomain: 'stara.example.test',
        projectId: 'stara-test',
        appId: 'browser-app',
      },
      'stara-identity-platform',
    );
    expect(auth.tenantId).toBe('workforce-tenant');
    expect(mockConnectAuthEmulator).toHaveBeenCalledWith(auth, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
  });

  it('signs in a migrated password account without creating a LibreChat session', async () => {
    await expect(
      signInToIdentityPlatform(config, 'owner@example.com', 'password'),
    ).resolves.toEqual({ mfaRequired: false });

    expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
      auth,
      'owner@example.com',
      'password',
    );
  });

  it('retains and resolves a TOTP multi-factor challenge', async () => {
    const multiFactorError = Object.assign(new Error('MFA required'), {
      code: 'auth/multi-factor-auth-required',
    });
    const resolver = {
      hints: [{ factorId: 'totp', uid: 'totp-enrollment' }],
      resolveSignIn: jest.fn().mockResolvedValue({ user: {} }),
    };
    mockSignInWithEmailAndPassword.mockRejectedValue(multiFactorError);
    mockGetMultiFactorResolver.mockReturnValue(resolver);
    mockAssertionForSignIn.mockReturnValue({ kind: 'totp-assertion' });

    await expect(
      signInToIdentityPlatform(config, 'owner@example.com', 'password'),
    ).resolves.toEqual({ mfaRequired: true });
    await completeIdentityPlatformMfa('123456');

    expect(mockAssertionForSignIn).toHaveBeenCalledWith('totp-enrollment', '123456');
    expect(resolver.resolveSignIn).toHaveBeenCalledWith({ kind: 'totp-assertion' });
  });

  it('refreshes and signs out through the Firebase session', async () => {
    const getIdToken = jest.fn().mockResolvedValue('fresh-token');
    auth.currentUser = { getIdToken };

    await expect(refreshIdentityPlatformToken(config)).resolves.toBe('fresh-token');
    await signOutFromIdentityPlatform(config);

    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(mockSignOut).toHaveBeenCalledWith(auth);
  });

  it('subscribes to Firebase ID-token changes and returns generic credential errors', async () => {
    const onUser = jest.fn();
    const onError = jest.fn();
    subscribeToIdentityPlatform(config, onUser, onError);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockOnIdTokenChanged).toHaveBeenCalledWith(auth, onUser, onError);
    expect(identityPlatformErrorMessage({ code: 'auth/invalid-credential' })).toBe(
      'Invalid email or password.',
    );
  });
});
