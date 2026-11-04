import type { Greeter } from '../ports/greeter.port.js';

/**
 * Creates the greeter that always answers the same text. Other implementations
 * (a configured text, a translated one) export their own `createXxx(deps)`
 * factory, take what they need as arguments and read no global config; the
 * module chooses between them.
 *
 * @returns A greeter.
 */
export function createStaticGreeter(): Greeter {
  return { greet: () => 'hello world!!' };
}
