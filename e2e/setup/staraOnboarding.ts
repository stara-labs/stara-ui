import type { APIRequestContext, Page } from '@playwright/test';

const STARA_ONBOARDING_PATH = 'api/user/settings/onboarding/stara';

function onboardingURL(baseURL?: string) {
  if (!baseURL) {
    return `/${STARA_ONBOARDING_PATH}`;
  }
  const normalizedBaseURL = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  return new URL(STARA_ONBOARDING_PATH, normalizedBaseURL).toString();
}

export async function completeStaraOnboarding(
  request: APIRequestContext,
  options: { baseURL?: string; seededBy?: string; token?: string } = {},
) {
  const response = await request.put(onboardingURL(options.baseURL), {
    data: {
      mode: 'personal',
      recommendedStart: 'chat',
      responses: {
        seededBy: options.seededBy ?? 'e2e',
      },
    },
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
  });

  if (!response.ok()) {
    throw new Error(
      `E2E Stara onboarding completion failed: ${response.status()} ${await response.text()}`,
    );
  }
}

export async function getAccessToken(page: Page): Promise<string> {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, text, json };
  });

  if (!result.ok) {
    throw new Error(
      `Expected /api/auth/refresh to return 2xx, got ${result.status}: ${result.text}`,
    );
  }

  const body = result.json as { token?: string } | null;
  if (!body?.token) {
    throw new Error(`Expected /api/auth/refresh to return a token, got: ${result.text}`);
  }

  return body.token;
}
