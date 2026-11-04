'use client';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { SnackbarProvider } from 'notistack';
import type { PropsWithChildren } from 'react';

import { theme } from '@/shared/styles/theme';

/** How many notifications show at once. */
const MAX_SNACKS = 3;
/** How long a notification stays, in milliseconds. */
const AUTO_HIDE_MS = 4000;

/**
 * Provide MUI to the tree: the app theme and the CSS reset, and notistack's
 * `SnackbarProvider` that `useNotification` needs.
 *
 * @param props.children The application tree.
 */
export function UiProvider({ children }: PropsWithChildren) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider
        maxSnack={MAX_SNACKS}
        autoHideDuration={AUTO_HIDE_MS}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {children}
      </SnackbarProvider>
    </ThemeProvider>
  );
}
