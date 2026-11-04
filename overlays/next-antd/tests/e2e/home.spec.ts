import { expect, test } from '@playwright/test';

test('home shows Welcome in the theme heading colour', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { name: 'Welcome' });
  await expect(heading).toBeVisible();
  // `colorTextHeading` of src/shared/styles/theme.ts: only the antd stylesheet
  // under the ConfigProvider theme produces this colour and weight.
  await expect(heading).toHaveCSS('color', 'rgb(20, 33, 61)');
  await expect(heading).toHaveCSS('font-weight', '600');
});
