import { toast } from '@heroui/react';

import { TOAST_TIMEOUT_MS } from '@/shared/styles/theme';

/** The four notification methods every UI variant of the template exposes. */
export interface Notification {
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

/** Options shared by every toast. */
const OPTIONS = { timeout: TOAST_TIMEOUT_MS };

/** The notification object; `toast` is a plain function, so it never changes. */
const notification: Notification = {
  success: (message) => void toast.success(message, OPTIONS),
  // HeroUI names its error variant `danger`.
  error: (message) => void toast.danger(message, OPTIONS),
  warning: (message) => void toast.warning(message, OPTIONS),
  info: (message) => void toast.info(message, OPTIONS),
};

/**
 * The app's notification API over HeroUI's toast. The toast host is mounted by
 * `UiProvider`.
 *
 * @returns The four notification methods; the object is the same every call.
 */
export function useNotification(): Notification {
  return notification;
}
