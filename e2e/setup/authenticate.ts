import { chromium } from '@playwright/test';
import type { FullConfig, Page } from '@playwright/test';
import type { User } from '../types';
import cleanupUser from './cleanupUser';
import { completeStaraOnboarding, getAccessToken } from './staraOnboarding';
import dotenv from 'dotenv';
dotenv.config();

const timeout = Number(process.env.E2E_AUTH_TIMEOUT ?? 15000);
const chromiumChannel = process.env.E2E_CHROMIUM_CHANNEL || undefined;

async function register(page: Page, user: User) {
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.getByLabel('Full name').click();
  await page.getByLabel('Full name').fill(user.name);
  await page.getByLabel('Email').click();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Email').press('Tab');
  await page.getByTestId('password').click();
  await page.getByTestId('password').fill(user.password);
  await page.getByTestId('confirm_password').click();
  await page.getByTestId('confirm_password').fill(user.password);
  await page.getByLabel('Submit registration').click();
}

async function registrationErrorIsVisible(page: Page) {
  return page
    .getByTestId('registration-error')
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

async function login(page: Page, user: User) {
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByTestId('login-button').click();
}

function appURL(baseURL: string, pathname = '') {
  const normalizedBaseURL = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  return new URL(pathname.replace(/^\/+/, ''), normalizedBaseURL).toString();
}

async function authenticate(config: FullConfig, user: User) {
  console.log('E2E global setup started');
  const { baseURL, storageState } = config.projects[0].use;
  console.log('E2E baseURL:', baseURL);
  console.log('E2E user:', user.email);
  if (typeof storageState !== 'string') {
    throw new Error('E2E storageState must be a file path');
  }

  const browser = await chromium.launch({
    headless: config.projects[0].use.headless ?? true,
    ...(chromiumChannel ? { channel: chromiumChannel } : {}),
  });
  try {
    const page = await browser.newPage();
    console.log('Authenticating E2E user:', user.email);

    if (typeof baseURL !== 'string') {
      throw new Error('E2E baseURL is not defined');
    }
    const conversationURL = appURL(baseURL, 'c/new');
    const loginURL = appURL(baseURL, 'login');

    await page.context().addInitScript(() => {
      localStorage.setItem('navVisible', 'true');
    });
    console.log('E2E localStorage set nav visible:', storageState);

    await page.goto(baseURL, { timeout });
    await register(page, user);
    try {
      await page.waitForURL(conversationURL, { timeout });
    } catch (error) {
      console.error('E2E registration error:', error);
      if (await registrationErrorIsVisible(page)) {
        console.log('E2E user already exists, cleaning up and retrying');
        await cleanupUser(user);
        await page.goto(baseURL, { timeout });
        await register(page, user);
        await page.waitForURL(conversationURL, { timeout });
      } else {
        throw new Error('E2E user failed to register');
      }
    }
    console.log('E2E user successfully registered');

    await page.goto(loginURL, { timeout });
    await login(page, user);
    await page.waitForURL(conversationURL, { timeout });
    const token = await getAccessToken(page);
    await completeStaraOnboarding(page.context().request, {
      baseURL,
      seededBy: 'e2e-authenticate',
      token,
    });
    console.log('Stara onboarding completed for E2E user');
    console.log('E2E user successfully authenticated');

    await page.context().storageState({ path: storageState });
    console.log('E2E authentication state saved in', storageState);
  } finally {
    await browser.close();
    console.log('E2E global setup finished');
  }
}

export default authenticate;
