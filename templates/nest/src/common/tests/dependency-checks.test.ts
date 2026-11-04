import { describe, expect, it } from 'vitest';

import {
  StartupCheckError,
  createHealthProbe,
  runStartupChecks,
  type DependencyCheck,
} from '../dependency-checks.js';

/**
 * A check that counts its runs.
 *
 * @param outcome - What `run` does: resolve, reject or never settle.
 * @returns The check and its run counter.
 */
function counting(outcome: 'ok' | 'fail' | 'hang' = 'ok') {
  const state = { runs: 0 };
  const check: DependencyCheck = {
    name: 'fake',
    run: () => {
      state.runs += 1;
      if (outcome === 'hang') return new Promise<never>(() => undefined);
      return outcome === 'ok'
        ? Promise.resolve('up')
        : Promise.reject(new Error('connect ECONNREFUSED secret-host:5432'));
    },
  };
  return { check, state };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('health probe', () => {
  it('is healthy when there are no checks', async () => {
    await expect(createHealthProbe([])()).resolves.toBe(true);
  });

  it('shares one in-flight run between concurrent callers', async () => {
    const { check, state } = counting();
    const probe = createHealthProbe([check]);

    const answers = await Promise.all([probe(), probe(), probe()]);

    expect(answers).toEqual([true, true, true]);
    expect(state.runs).toBe(1);
  });

  it('reuses a result inside the window and runs again after it', async () => {
    const { check, state } = counting();
    const probe = createHealthProbe([check], { cacheMs: 30 });

    await probe();
    await probe();
    expect(state.runs).toBe(1);

    await sleep(50);
    await probe();
    expect(state.runs).toBe(2);
  });

  it('reuses a failure for the window too, and reports it once', async () => {
    const { check, state } = counting('fail');
    const reported: string[][] = [];
    const probe = createHealthProbe([check], {
      cacheMs: 50,
      onFailure: (names) => reported.push([...names]),
    });

    expect(await probe()).toBe(false);
    expect(await probe()).toBe(false);

    expect(state.runs).toBe(1);
    expect(reported).toEqual([['fake']]);
  });

  it('fails a check that does not answer within its bound', async () => {
    const { check } = counting('hang');
    const probe = createHealthProbe([check], { timeoutMs: 20 });

    expect(await probe()).toBe(false);
  });

  it('answers from the checks when the failure callback throws, and keeps working', async () => {
    const { check, state } = counting('fail');
    const probe = createHealthProbe([check], {
      cacheMs: 20,
      onFailure: () => {
        throw new Error('log sink is down');
      },
    });

    expect(await probe()).toBe(false);

    await sleep(40);
    expect(await probe()).toBe(false);
    expect(state.runs).toBe(2);
  });
});

describe('startup checks', () => {
  it('passes when every check passes, and with none', async () => {
    await expect(runStartupChecks([])).resolves.toBeUndefined();
    await expect(runStartupChecks([counting().check])).resolves.toBeUndefined();
  });

  it('names a failing check and holds none of its error text', async () => {
    const error = await runStartupChecks([counting('fail').check]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(StartupCheckError);
    expect((error as Error).message).toBe('dependency check failed: fake');
    expect((error as Error).message).not.toContain('secret-host');
  });

  it('names a check that hangs, within its bound', async () => {
    const started = Date.now();
    const error = await runStartupChecks([counting('hang').check], {
      timeoutMs: 20,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StartupCheckError);
    expect((error as Error).message).toBe('dependency check failed: fake');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
