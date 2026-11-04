import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('the server-rendered page carries the MUI styles in its head', async ({
  page,
}) => {
  await page.goto('/');
  // With JavaScript off, the styles that AppRouterCacheProvider collected are
  // the only ones. Without it, emotion writes style tags with another cache
  // key into the body instead of the head.
  await expect(
    page.locator('head > style[data-emotion^="mui"]').first(),
  ).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toHaveCSS(
    'color',
    'rgb(11, 95, 165)',
  );
});
