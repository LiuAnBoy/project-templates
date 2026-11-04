import { expect, test } from '@playwright/test';

test('home shows Welcome styled by HeroUI and Tailwind', async ({ page }) => {
  await page.goto('/');
  const title = page.getByText('Welcome');
  await expect(title).toBeVisible();
  // `font-medium` comes from HeroUI's card stylesheet and `text-2xl` from
  // Tailwind: without the stylesheet the heading is bold at 18.72px.
  await expect(title).toHaveCSS('font-weight', '500');
  await expect(title).toHaveCSS('font-size', '24px');
  // `--foreground` is mapped from palette.text in src/shared/styles/theme.ts.
  await expect(title).toHaveCSS('color', 'rgb(15, 23, 42)');
});
