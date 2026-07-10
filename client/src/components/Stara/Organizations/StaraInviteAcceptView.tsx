import { useEffect } from 'react';
import { Button, Spinner } from '@librechat/client';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAcceptStaraOrganizationInviteMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function StaraInviteAcceptView() {
  const localize = useLocalize();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const acceptInvite = useAcceptStaraOrganizationInviteMutation();

  useEffect(() => {
    if (token && acceptInvite.status === 'idle') {
      acceptInvite.mutate({ token });
    }
  }, [acceptInvite, token]);

  let title = 'Accepting org invite';
  let description = 'Stara is validating the invite and updating your active org.';
  if (!token) {
    title = 'Invite link is missing a token';
    description = 'Ask the org admin to send a new invite.';
  } else if (acceptInvite.isSuccess) {
    title = 'Org invite accepted';
    description =
      'Your account is now connected to the org. Stara may ask for the org addendum next.';
  } else if (acceptInvite.isError) {
    title = 'Invite could not be accepted';
    description = 'The invite may be expired, revoked, already used, or sent to a different email.';
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="grid w-full max-w-md gap-4 rounded-lg border border-border-light bg-surface-primary p-6 shadow-sm">
        <div className="grid gap-2">
          <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
          <p className="text-sm leading-6 text-text-secondary">{description}</p>
        </div>
        {acceptInvite.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Spinner className="h-4 w-4" />
            <span>Checking invite...</span>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button onClick={() => navigate('/')}>{localize('com_ui_continue')}</Button>
          <Button variant="outline" onClick={() => navigate('/onboarding?mode=review')}>
            {localize('com_ui_stara_onboarding_review')}
          </Button>
        </div>
      </div>
    </div>
  );
}
