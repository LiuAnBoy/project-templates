/** The port the hello service depends on: where the greeting comes from. */
export interface Greeter {
  /**
   * Produces the greeting.
   *
   * @returns The greeting text.
   */
  greet(): string;
}

/** The injection token of the `Greeter` port. */
export const GREETER = Symbol('GREETER');
