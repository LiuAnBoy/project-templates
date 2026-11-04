import { expect, test } from '@playwright/test';

import { palette } from '../../src/shared/styles/theme';

test('home shows Welcome', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome')).toBeVisible();
});

test('the theme reaches the page through CSS variables', async ({ page }) => {
  await page.goto('/');
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--theme-primary')
      .trim(),
  );
  expect(primary).toBe(palette.primary);
  // global.css reads --theme-text for the body, so the page text has that colour.
  await expect(page.getByText('Welcome')).toHaveCSS('color', 'rgb(15, 23, 42)');
});
