import { expect, test } from '@playwright/test';

test('home shows Welcome', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome')).toBeVisible();
});
