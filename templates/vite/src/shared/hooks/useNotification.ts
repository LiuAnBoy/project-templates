import { createContext, useContext } from 'react';

/** The four notification methods every UI variant of the template exposes. */
export interface Notification {
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

/** Carries the notification methods from `UiProvider` to the hook. */
export const NotificationContext = createContext<Notification | null>(null);

/**
 * The app's notification API. The plain `UiProvider` shows each message in a
 * small region at the top right and removes it after a few seconds.
 *
 * @returns The four notification methods; the object is stable between renders.
 * @throws When no `UiProvider` is mounted above the caller.
 */
export function useNotification(): Notification {
  const notification = useContext(NotificationContext);
  if (!notification) {
    throw new Error('useNotification needs the UiProvider above it');
  }
  return notification;
}
