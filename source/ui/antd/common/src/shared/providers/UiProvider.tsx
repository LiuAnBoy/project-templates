'use client';

import { App, ConfigProvider } from 'antd';
import zhTW from 'antd/locale/zh_TW';
import type { PropsWithChildren } from 'react';

import { appTheme } from '@/shared/styles/theme';

/**
 * Provide Ant Design to the tree: the Traditional Chinese locale and the app
 * theme through `ConfigProvider`, and antd's `App` so that notifications and
 * modals opened from `App.useApp()` see the theme and locale.
 *
 * @param props.children The application tree.
 */
export function UiProvider({ children }: PropsWithChildren) {
  return (
    <ConfigProvider locale={zhTW} theme={appTheme}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
