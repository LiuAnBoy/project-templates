import { expect, test } from '@playwright/test';

test('home shows Welcome in the theme primary colour', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { name: 'Welcome' });
  await expect(heading).toBeVisible();
  // `palette.primary.main` of src/shared/styles/theme.ts and the h3 size of
  // MUI's typography: only the MUI styles under the ThemeProvider produce them.
  await expect(heading).toHaveCSS('color', 'rgb(11, 95, 165)');
  await expect(heading).toHaveCSS('font-size', '48px');
});
