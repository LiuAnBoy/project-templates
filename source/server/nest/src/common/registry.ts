/** A keyed collection of implementations of one port. */
export interface Registry<T> {
  /**
   * Adds an implementation under a key.
   *
   * @param key - The unique name of the implementation.
   * @param value - The implementation.
   * @throws Error when the key is already registered.
   */
  register(key: string, value: T): void;
  /**
   * Looks an implementation up.
   *
   * @param key - The name it was registered under.
   * @returns The implementation.
   * @throws Error when nothing is registered under the key.
   */
  get(key: string): T;
  /**
   * Lists every implementation, in registration order.
   *
   * @returns The implementations.
   */
  all(): T[];
}

/**
 * Creates a registry for the several implementations of one port (news
 * sources, notification channels, payment providers). Registering a duplicate
 * key throws, so two implementations can never silently shadow each other.
 *
 * @returns An empty registry.
 */
export function createRegistry<T>(): Registry<T> {
  const items = new Map<string, T>();
  return {
    register(key, value) {
      if (items.has(key)) throw new Error(`already registered: ${key}`);
      items.set(key, value);
    },
    get(key) {
      if (!items.has(key)) throw new Error(`not registered: ${key}`);
      return items.get(key) as T;
    },
    all() {
      return [...items.values()];
    },
  };
}
