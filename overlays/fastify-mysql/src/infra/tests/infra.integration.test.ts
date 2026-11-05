import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.js';
import {
  createProbe,
  testTarget,
  type Probe,
  type TestTarget,
} from '../../db/tests/support.js';
import { createInfra } from '../infra.js';
import type { Infra } from '../types.js';

describe('the real createInfra', () => {
  let target: TestTarget;
  let infra: Infra;
  let probe: Probe;

  beforeAll(async () => {
    target = await testTarget();
    infra = createInfra(
      loadConfig({ ...process.env, DATABASE_URL: target.url }),
    );
    probe = await createProbe(infra);
  });
  afterAll(async () => {
    await probe.drop();
    await infra.close();
    await target.dispose();
  });

  it('hands out the database and the runner, and one transaction through them commits', async () => {
    await infra.transactions.run((tx) => probe.insert(tx, 'seam'));

    expect(await probe.exists(infra.db, 'seam')).toBe(true);
  });

  it('provides one passing dependency check, which fails once the infra is closed', async () => {
    expect(infra.checks).toHaveLength(1);
    await expect(infra.checks[0]?.run()).resolves.toBeUndefined();

    const other = createInfra(
      loadConfig({ ...process.env, DATABASE_URL: target.url }),
    );
    await other.close();

    await expect(other.checks[0]?.run()).rejects.toThrow();
  });
});
