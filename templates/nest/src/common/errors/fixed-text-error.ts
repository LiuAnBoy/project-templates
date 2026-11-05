/**
 * An error whose message we wrote ourselves and which holds no value: a fixed
 * sentence that may name a dependency, never a host, a path or anything from a
 * setting. It carries a code as a driver's error does, so `isDependencyOutage`
 * reads it, and it is the one error the log and the startup line print in full
 * whatever that code says.
 */
export class FixedTextError extends Error {
  /**
   * @param message - The fixed text.
   * @param code - A Node errno or a driver's code.
   */
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'FixedTextError';
  }
}
