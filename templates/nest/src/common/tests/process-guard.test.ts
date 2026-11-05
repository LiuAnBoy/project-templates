import { describe, expect, it } from 'vitest';

import { handleStrayFailure } from '../process-guard.js';

/**
 * Handles one failure with both effects recorded.
 *
 * @param failure - What nothing caught.
 * @returns The lines written and the exit codes asked for.
 */
function handle(failure: unknown): { lines: string[]; exits: number[] } {
  const lines: string[] = [];
  const exits: number[] = [];
  handleStrayFailure('unhandled rejection', failure, {
    write: (line) => lines.push(line),
    exit: (code) => exits.push(code),
  });
  return { lines, exits };
}

describe('a failure nothing caught', () => {
  it('reproduces a lost connection in a stray promise: the process stays up and the log names no host', () => {
    const { lines, exits } = handle(
      Object.assign(new Error('connect ECONNREFUSED canary-host:5432'), {
        code: 'ECONNREFUSED',
      }),
    );

    expect(exits).toEqual([]);
    expect(lines[0]).toContain('ECONNREFUSED');
    expect(lines[0]).not.toContain('canary-host');
  });

  it('ends the process on anything else, as Node would', () => {
    const { lines, exits } = handle(new TypeError('x is not a function'));

    expect(exits).toEqual([1]);
    expect(lines[0]).toContain('x is not a function');
  });
});
