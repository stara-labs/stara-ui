import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { User } from '../../types';
import cleanupUser from '../../setup/cleanupUser';
import { completeStaraOnboarding } from '../../setup/staraOnboarding';
import { getPrimaryE2EUser } from '../../setup/users.mock';
import { NEW_CHAT_PATH } from './helpers';

/**
 * Regression test for the framer-motion / Vite incompatibility that crashed the
 * client with "e is not a function" when opening the Enable 2FA dialog
 * (issue #13511). The dialog body is a framer-motion `<motion.div>`; on the
 * broken build it throws while rendering, so the dialog never appears.
 *
 * This only reproduces in a production build (the mock harness builds the client
 * via `e2e:prepare`), matching the original report.
 */
async function getMfaDisabledStorageState(request: APIRequestContext, user: User) {
  await cleanupUser(user);

  const registerResponse = await request.post('/api/auth/register', {
    data: {
      email: user.email,
      name: user.name,
      password: user.password,
      confirm_password: user.password,
    },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const loginResponse = await request.post('/api/auth/login', {
    data: {
      email: user.email,
      password: user.password,
    },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginPayload = (await loginResponse.json()) as { token?: string };
  if (!loginPayload.token) {
    throw new Error('Expected login response to include a bearer token');
  }

  await completeStaraOnboarding(request, {
    seededBy: 'two-factor-spec',
    token: loginPayload.token,
  });

  return request.storageState();
}

function getTwoFactorUser(): User {
  const primaryEmail = getPrimaryE2EUser().email;
  const domain = primaryEmail.includes('@') ? primaryEmail.split('@').pop() : 'example.com';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    email: `two-factor-${unique}@${domain}`,
    name: 'Two Factor Test User',
    password: 'securepassword789',
  };
}

test.describe('account settings · two-factor dialog', () => {
  test('opening the Enable 2FA dialog renders without a framer-motion crash', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(60000);
    if (typeof baseURL !== 'string') {
      throw new Error('baseURL must be configured for mock two-factor tests');
    }

    const framerErrors: string[] = [];
    const user = getTwoFactorUser();
    const context = await browser.newContext({
      storageState: await getMfaDisabledStorageState(request, user),
      baseURL,
    });
    await context.addInitScript(() => {
      localStorage.setItem('navVisible', 'true');
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => {
      if (/is not a function/i.test(error.message)) {
        framerErrors.push(error.message);
      }
    });

    try {
      await page.goto(NEW_CHAT_PATH, { timeout: 10000 });

      await page.getByTestId('nav-user').click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Account' }).click();

      // Opening the dialog mounts the framer-motion-animated body — the crash site.
      await page.getByRole('button', { name: 'Enable 2FA' }).click();

      // With the broken framer-motion build this content never renders.
      await expect(page.locator('#two-factor-authentication-dialog')).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole('button', { name: 'Generate QR Code' })).toBeVisible();

      expect(
        framerErrors,
        `framer-motion threw while rendering the 2FA dialog: ${framerErrors.join(' | ')}`,
      ).toEqual([]);
    } finally {
      await context.close().catch(() => undefined);
      await cleanupUser(user);
    }
  });
});
