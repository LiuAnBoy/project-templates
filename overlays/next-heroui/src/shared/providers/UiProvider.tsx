'use client';

import { Toast } from '@heroui/react';
import type { PropsWithChildren } from 'react';

import { TOAST_MAX_VISIBLE, TOAST_PLACEMENT } from '@/shared/styles/theme';

/**
 * Provide HeroUI to the tree. HeroUI v3 components need no context, so this
 * only mounts the toast host once, beside the application. A toast sent
 * before the host mounts is kept and shown once it does.
 *
 * @param props.children The application tree.
 */
export function UiProvider({ children }: PropsWithChildren) {
  return (
    <>
      {children}
      <Toast.Provider
        placement={TOAST_PLACEMENT}
        maxVisibleToasts={TOAST_MAX_VISIBLE}
      />
    </>
  );
}
