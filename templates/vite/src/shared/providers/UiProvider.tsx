'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
} from 'react';

import {
  NotificationContext,
  type Notification,
} from '@/shared/hooks/useNotification';
import { palette, radius } from '@/shared/styles/theme';

/** How long a notification stays, in milliseconds. */
const DISMISS_MS = 4000;

type Kind = keyof Notification;

interface Item {
  id: number;
  kind: Kind;
  message: string;
}

/** The accent colour of each kind, from `theme.ts`. */
const ACCENT: Record<Kind, string> = {
  success: palette.success,
  error: palette.danger,
  warning: palette.warning,
  info: palette.primary,
};

const regionStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: 'min(360px, calc(100vw - 32px))',
};

const itemStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: radius,
  borderLeft: '4px solid',
  background: palette.surface,
  color: palette.text,
};

/**
 * The slot for a UI library's provider. This base ships no UI library, so it
 * provides `useNotification` itself: it keeps the shown messages and renders
 * them in an `aria-live` region, each removed after a few seconds. A UI
 * overlay replaces this file and `useNotification.ts` with the library's own;
 * `AppProviders` composes it and needs no change.
 *
 * @param props.children The application tree.
 */
export function UiProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const notification = useMemo<Notification>(() => {
    const show = (kind: Kind, message: string) => {
      const id = nextId.current++;
      setItems((current) => [...current, { id, kind, message }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setItems((current) => current.filter((item) => item.id !== id));
      }, DISMISS_MS);
      timers.current.add(timer);
    };
    return {
      success: (message) => show('success', message),
      error: (message) => show('error', message),
      warning: (message) => show('warning', message),
      info: (message) => show('info', message),
    };
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return (
    <NotificationContext.Provider value={notification}>
      {children}
      <div aria-live="polite" style={regionStyle}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{ ...itemStyle, borderLeftColor: ACCENT[item.kind] }}
          >
            {item.message}
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
