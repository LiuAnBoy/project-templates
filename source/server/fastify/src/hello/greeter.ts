/** The port the hello service depends on: where the greeting comes from. */
export interface Greeter {
  /**
   * Produces the greeting.
   *
   * @returns The greeting text.
   */
  greet(): string;
}

/**
 * Creates the greeter that always answers the same text. Other
 * implementations (a configured text, a translated one) export their own
 * `createXxx(deps)` factory and are chosen where the module is wired.
 *
 * @returns A greeter.
 */
export function createStaticGreeter(): Greeter {
  return { greet: () => 'hello world!!' };
}
