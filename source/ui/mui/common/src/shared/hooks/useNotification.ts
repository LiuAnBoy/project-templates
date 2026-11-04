import { useSnackbar } from 'notistack';
import { useMemo } from 'react';

/** The four notification methods every UI variant of the template exposes. */
export interface Notification {
  success(message: string): void;
  error(message: string): void;
  warning(message: string): void;
  info(message: string): void;
}

/**
 * The app's notification API over notistack's snackbars. Needs the
 * `UiProvider` above it, which mounts the `SnackbarProvider`.
 *
 * @returns The four notification methods; the object is stable between renders.
 */
export function useNotification(): Notification {
  const { enqueueSnackbar } = useSnackbar();
  return useMemo(
    () => ({
      success: (message) =>
        void enqueueSnackbar(message, { variant: 'success' }),
      error: (message) => void enqueueSnackbar(message, { variant: 'error' }),
      warning: (message) =>
        void enqueueSnackbar(message, { variant: 'warning' }),
      info: (message) => void enqueueSnackbar(message, { variant: 'info' }),
    }),
    [enqueueSnackbar],
  );
}
