import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VerifyEmail from '../VerifyEmail';

const mockNavigate = jest.fn();
const mockApplyIdentityPlatformEmailVerification = jest.fn();
const mockRememberIdentityPlatformSignupInvite = jest.fn();
const mockLegacyVerify = jest.fn();
let mockParams = new URLSearchParams();
let mockStartupConfig: Record<string, unknown> = { isFetched: true, data: {} };

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockParams],
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <div role="status" />,
  ThemeSelector: () => null,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockStartupConfig,
  useVerifyEmailMutation: () => ({ isLoading: false, mutate: mockLegacyVerify }),
  useResendVerificationEmail: () => ({ isLoading: false, mutate: jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/lib/auth/identityPlatform', () => ({
  applyIdentityPlatformEmailVerification: (...args: unknown[]) =>
    mockApplyIdentityPlatformEmailVerification(...args),
  identityPlatformErrorMessage: (error: Error) => error.message,
  rememberIdentityPlatformSignupInvite: (...args: unknown[]) =>
    mockRememberIdentityPlatformSignupInvite(...args),
}));

const identityPlatform = {
  enabled: true as const,
  apiKey: 'public-key',
  projectId: 'stara-test',
  authDomain: 'stara-test.firebaseapp.com',
};

describe('VerifyEmail Identity Platform action handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = new URLSearchParams();
    mockStartupConfig = { isFetched: true, data: { identityPlatform } };
    mockApplyIdentityPlatformEmailVerification.mockResolvedValue(undefined);
  });

  it('applies the action code and retains the invitation from the continue URL', async () => {
    const inviteToken = 'invite_token_123456789012345678901234';
    const continueUrl = `https://control-plane.stara.co/verify?invite_token=${inviteToken}`;
    mockParams = new URLSearchParams({
      mode: 'verifyEmail',
      oobCode: 'verification-code',
      continueUrl,
    });

    render(<VerifyEmail />);

    await waitFor(() => {
      expect(mockApplyIdentityPlatformEmailVerification).toHaveBeenCalledWith(
        identityPlatform,
        'verification-code',
      );
      expect(mockRememberIdentityPlatformSignupInvite).toHaveBeenCalledWith(undefined, inviteToken);
    });
    expect(
      screen.getByRole('heading', {
        name: 'Email verified. Sign in to set up multi-factor authentication.',
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('fails closed when the verification action code is missing', async () => {
    render(<VerifyEmail />);

    expect(
      await screen.findByRole('heading', {
        name: 'This verification link is invalid or incomplete.',
      }),
    ).toBeInTheDocument();
    expect(mockApplyIdentityPlatformEmailVerification).not.toHaveBeenCalled();
  });

  it('routes password reset actions through the existing reset form', async () => {
    mockParams = new URLSearchParams({
      mode: 'resetPassword',
      oobCode: 'reset-code',
      continueUrl: 'https://control-plane.stara.co/login',
    });

    render(<VerifyEmail />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/reset-password?mode=resetPassword&oobCode=reset-code&continueUrl=https%3A%2F%2Fcontrol-plane.stara.co%2Flogin',
        { replace: true },
      );
    });
    expect(mockApplyIdentityPlatformEmailVerification).not.toHaveBeenCalled();
  });

  it('fails closed for unsupported Identity Platform email action modes', async () => {
    mockParams = new URLSearchParams({ mode: 'recoverEmail', oobCode: 'recovery-code' });

    render(<VerifyEmail />);

    expect(
      await screen.findByRole('heading', { name: 'com_auth_email_verification_invalid' }),
    ).toBeInTheDocument();
    expect(mockApplyIdentityPlatformEmailVerification).not.toHaveBeenCalled();
  });

  it('leaves the legacy email verification mutation in place outside Identity Platform mode', async () => {
    mockStartupConfig = { isFetched: true, data: {} };
    mockParams = new URLSearchParams({ token: 'legacy-token', email: 'legacy@example.com' });

    render(<VerifyEmail />);

    await waitFor(() => {
      expect(mockLegacyVerify).toHaveBeenCalledWith({
        token: 'legacy-token',
        email: 'legacy@example.com',
      });
    });
    expect(mockApplyIdentityPlatformEmailVerification).not.toHaveBeenCalled();
  });
});
