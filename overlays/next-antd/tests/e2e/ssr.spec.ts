import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('the server-rendered page already carries the antd styles', async ({
  page,
}) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { name: 'Welcome' });
  // With JavaScript off, only the styles that AntdRegistry put into the HTML
  // can colour the heading.
  await expect(heading).toHaveCSS('color', 'rgb(20, 33, 61)');
  await expect(heading).toHaveCSS('font-weight', '600');
});
