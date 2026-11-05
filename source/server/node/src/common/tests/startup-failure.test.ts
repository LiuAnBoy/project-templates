import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { StartupCheckError } from '../dependency-checks.js';
import { FixedTextError } from '../errors/fixed-text-error.js';
import { describeStartupFailure } from '../errors/startup-failure.js';

describe('describeStartupFailure', () => {
  it('names the settings of a validation failure and no value', () => {
    const result = z
      .object({
        REDIS_URL: z.string().regex(/^redis/),
        PORT: z.coerce.number(),
      })
      .safeParse({ REDIS_URL: 'canary-value', PORT: 'canary-port' });

    const line = describeStartupFailure(result.error);

    expect(line).toBe('invalid configuration: REDIS_URL, PORT');
  });

  it('prints the text of a failed check and of a fixed error', () => {
    expect(describeStartupFailure(new StartupCheckError(['postgres']))).toBe(
      'failed to start: dependency check failed: postgres',
    );
    expect(
      describeStartupFailure(
        new FixedTextError('sqlite: cannot open', 'SQLITE_CANTOPEN'),
      ),
    ).toBe('failed to start: sqlite: cannot open');
  });

  it('reproduces a parser quoting its input: the class, the code and the frames stay, the message does not', () => {
    let parseError: unknown;
    try {
      new URL('redis://:canary-pw@h:canary-port');
    } catch (error) {
      parseError = error;
    }

    const text = describeStartupFailure(parseError);

    expect(text).toMatch(/^failed to start: TypeError\[ERR_INVALID_URL\]/);
    expect(text).toContain('startup-failure.test');
    expect(text).not.toContain('canary');
  });

  it('names every link of a chain by its shape alone', () => {
    const error = new Error('outer canary-a', {
      cause: Object.assign(new Error('inner canary-b'), { code: 'ENOTFOUND' }),
    });

    const text = describeStartupFailure(error);

    expect(text.split('\n')[0]).toBe(
      'failed to start: Error <- Error[ENOTFOUND]',
    );
    expect(text).not.toContain('canary');
  });

  it('survives a thrown value that is not an error', () => {
    expect(describeStartupFailure('canary')).toBe('failed to start: string');
    expect(describeStartupFailure(undefined)).toBe(
      'failed to start: unknown error',
    );
  });
});
