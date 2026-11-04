/**
 * Fails on a value the type system says cannot exist.
 *
 * A `switch` over a union gets no exhaustiveness check when it returns
 * nothing, so a new member silently falls through. Passing the value here
 * turns the new member into a compile error at the one place that must decide
 * what to do about it. Returns the error so callers write `throw assertNever(x)`.
 *
 * @param value - The unhandled member.
 * @returns An error naming what was not handled, for the caller to throw.
 */
export function assertNever(value: never): Error {
  return new Error(`Unhandled variant: ${String(value)}`);
}
