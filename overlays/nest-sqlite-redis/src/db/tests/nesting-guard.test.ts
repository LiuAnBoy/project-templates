import { describe, expect, it } from 'vitest';

import { createNestingGuard } from '../nesting-guard.js';

const REFUSAL = /called inside a transaction; pass the handle down/;

/**
 * Waits for a moment.
 *
 * @param ms - How long.
 * @returns Resolves after it.
 */
const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('the nesting guard', () => {
  it('refuses a nested call at once, before anything runs', async () => {
    const guard = createNestingGuard('store', 'handle');
    let ran = false;

    const outcome = await guard.enter(() =>
      guard
        .enter(() => {
          ran = true;
          return Promise.resolve();
        })
        .catch((error: unknown) => error),
    );

    expect((outcome as Error).message).toMatch(REFUSAL);
    expect(ran).toBe(false);
  });

  it('reproduces a timer set inside that fires after the transaction ended: it opens its own', async () => {
    const guard = createNestingGuard('store', 'handle');
    let late: Promise<string> | undefined;

    await guard.enter(() => {
      late = wait(10).then(() => guard.enter(() => Promise.resolve('opened')));
      return Promise.resolve();
    });

    await expect(late).resolves.toBe('opened');
  });

  it('refuses work started inside while the transaction is still open, even when the callback does not wait for it', async () => {
    const guard = createNestingGuard('store', 'handle');
    let during: Promise<unknown> | undefined;

    await guard.enter(async () => {
      during = wait(5).then(() =>
        guard
          .enter(() => Promise.resolve('opened'))
          .catch((error: unknown) => error),
      );
      await wait(30);
    });

    expect(((await during) as Error).message).toMatch(REFUSAL);
  });

  it('counts the whole transaction: a call made during the commit is refused', async () => {
    const guard = createNestingGuard('store', 'handle');
    let committing: Promise<unknown> | undefined;

    await guard.enter(async () => {
      committing = guard
        .enter(() => Promise.resolve('opened'))
        .catch((error: unknown) => error);
      await wait(5);
    });

    expect(((await committing) as Error).message).toMatch(REFUSAL);
  });

  it('leaves sibling calls alone, and two stores do not see each other', async () => {
    const first = createNestingGuard('first', 'handle');
    const second = createNestingGuard('second', 'handle');

    const [one, two, across] = await Promise.all([
      first.enter(() => wait(5).then(() => 'one')),
      first.enter(() => wait(5).then(() => 'two')),
      first.enter(() => second.enter(() => Promise.resolve('across'))),
    ]);

    expect([one, two, across]).toEqual(['one', 'two', 'across']);
  });

  it('ends the scope when the transaction fails', async () => {
    const guard = createNestingGuard('store', 'handle');

    await expect(
      guard.enter(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(guard.enter(() => Promise.resolve('next'))).resolves.toBe(
      'next',
    );
  });
});
