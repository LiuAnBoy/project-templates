/** Handle on the installed `matchMedia` stub. */
export interface MatchMediaStub {
  /** Sets whether a query matches and notifies the listeners subscribed to it. */
  set: (query: string, matches: boolean) => void;
  /** The number of change listeners currently subscribed to a query. */
  listenerCount: (query: string) => number;
}

type Listener = (event: MediaQueryListEvent) => void;

const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');

/**
 * Install a controllable `window.matchMedia`. Only the queries in `matching`
 * match at first; every other query does not. jsdom has no `matchMedia`, and
 * UI libraries and `useMediaQuery` read it.
 *
 * @param matching The queries that match at first.
 * @returns The handle that flips a query and counts its listeners.
 */
export function installMatchMedia(
  matching: readonly string[] = [],
): MatchMediaStub {
  const state = new Map<string, boolean>(matching.map((q) => [q, true]));
  const listeners = new Map<string, Set<Listener>>();
  const listenersOf = (query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    return listeners.get(query)!;
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        return state.get(query) ?? false;
      },
      addEventListener: (type: string, listener: Listener) => {
        if (type === 'change') listenersOf(query).add(listener);
      },
      removeEventListener: (type: string, listener: Listener) => {
        if (type === 'change') listenersOf(query).delete(listener);
      },
    }),
  });

  return {
    set: (query, matches) => {
      state.set(query, matches);
      for (const listener of [...listenersOf(query)]) {
        listener({ matches } as MediaQueryListEvent);
      }
    },
    listenerCount: (query) => listenersOf(query).size,
  };
}

/** Restore the environment's own `matchMedia` (none in jsdom). Call it in `afterEach`. */
export function restoreMatchMedia(): void {
  if (original) Object.defineProperty(window, 'matchMedia', original);
  else Reflect.deleteProperty(window, 'matchMedia');
}
