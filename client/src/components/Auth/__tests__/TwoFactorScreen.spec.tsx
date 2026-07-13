/**
 * @jest-environment @happy-dom/jest-environment
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TwoFactorScreen from '../TwoFactorScreen';

const mockCompleteIdentityPlatformMfa = jest.fn();
const mockShowToast = jest.fn();
const mockVerifyTempMutate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useOutletContext: () => ({
    startupConfig: {
      identityPlatform: {
        enabled: true,
        apiKey: 'public-key',
        projectId: 'stara-test',
      },
    },
  }),
  useSearchParams: () => [new URLSearchParams()],
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
  InputOTP: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      aria-label="verification-code"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  InputOTPGroup: ({ children }: React.PropsWithChildren) => <>{children}</>,
  InputOTPSeparator: () => null,
  InputOTPSlot: () => null,
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

jest.mock('~/data-provider', () => ({
  useVerifyTwoFactorTempMutation: () => ({ mutate: mockVerifyTempMutate }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/lib/auth/identityPlatform', () => ({
  completeIdentityPlatformMfa: (...args: unknown[]) => mockCompleteIdentityPlatformMfa(...args),
  identityPlatformErrorMessage: () => 'Authentication failed.',
}));

describe('TwoFactorScreen Identity Platform flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCompleteIdentityPlatformMfa.mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/login/2fa');
  });

  it('resolves the Firebase TOTP challenge and reloads the persisted session', async () => {
    render(<TwoFactorScreen />);

    fireEvent.change(screen.getByLabelText('verification-code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('login-button'));

    await waitFor(() => expect(mockCompleteIdentityPlatformMfa).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(mockVerifyTempMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('com_ui_use_backup_code')).not.toBeInTheDocument();
  });
});
