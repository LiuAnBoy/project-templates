import { expect, test } from '@playwright/test';

test('an unknown address shows the not-found page', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
});
