/**
 * The line a process prints when it cannot start.
 *
 * Everything that runs before the server listens reads the settings, and a thrown
 * error can quote what it read: a URL parser repeats the URL, a bind repeats the
 * host. So this prints what was written to be printed and only the shape of the
 * rest: the names of the settings that failed validation, the checks that failed,
 * the text of a `FixedTextError`, and for anything else the class, the code and the
 * frames, never the message.
 */
import { ZodError } from 'zod';

import { flattenCauses, read } from './cause-chain.js';
import { framesOf, nameOf } from './failure.js';
import { FixedTextError } from './fixed-text-error.js';
import { StartupCheckError } from '../dependency-checks.js';

/**
 * Names one link by its class and its code.
 *
 * @param link - One error in the chain.
 * @returns For example `TypeError[ERR_INVALID_URL]`.
 */
function shapeOf(link: unknown): string {
  if (typeof link !== 'object' || link === null) return typeof link;
  const code = read(link, 'code');
  return `${nameOf(link)}${typeof code === 'string' ? `[${code}]` : ''}`;
}

/**
 * Describes why the process could not start.
 *
 * @param error - Whatever was thrown before the server listened.
 * @returns The text to print: one line, then the frames of an unexpected error.
 */
export function describeStartupFailure(error: unknown): string {
  if (error instanceof ZodError) {
    const names = new Set(error.issues.map((issue) => issue.path.join('.')));
    return `invalid configuration: ${[...names].join(', ')}`;
  }
  if (error instanceof StartupCheckError || error instanceof FixedTextError) {
    return `failed to start: ${error.message}`;
  }
  const shape = flattenCauses(error)
    .map((found) => shapeOf(found.error))
    .join(' <- ');
  const line = `failed to start: ${shape || 'unknown error'}`;
  if (!(error instanceof Error) || error.stack === undefined) return line;
  const frames = framesOf(error.stack, error.message);
  return frames ? `${line}\n${frames}` : line;
}
