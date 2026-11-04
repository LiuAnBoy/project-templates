import type { Greeter } from './greeter.js';
import type { HelloData } from './schemas.js';

/** The dependencies of the hello service. */
export type HelloServiceDeps = { greeter: Greeter };

/**
 * Creates the hello service. It depends only on the `Greeter` port, passed in
 * as an argument, and reads no global state. A real service holds the business
 * flow and owns the transaction scope.
 *
 * @param deps - The ports the service uses.
 * @returns The service.
 */
export function createHelloService({ greeter }: HelloServiceDeps) {
  return {
    /**
     * Builds the greeting.
     *
     * @returns The data of the hello route.
     */
    getHello(): HelloData {
      return { message: greeter.greet() };
    },
  };
}
