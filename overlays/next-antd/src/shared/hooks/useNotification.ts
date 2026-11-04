import { App } from 'antd';
import { useMemo } from 'react';

/** The four notification methods every UI variant of the template exposes. */
export interface Notification {
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

/**
 * The app's notification API over Ant Design's `notification`. Needs the
 * `UiProvider` above it, because it reads `App.useApp()`.
 *
 * @returns The four notification methods; the object is stable between renders.
 */
export function useNotification(): Notification {
  const { notification } = App.useApp();
  return useMemo(
    () => ({
      success: (message) =>
        notification.success({ title: message, placement: 'topRight' }),
      error: (message) =>
        notification.error({ title: message, placement: 'topRight' }),
      warning: (message) =>
        notification.warning({ title: message, placement: 'topRight' }),
      info: (message) =>
        notification.info({ title: message, placement: 'topRight' }),
    }),
    [notification],
  );
}
