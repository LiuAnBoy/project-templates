import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { isDependencyOutage } from '../../common/errors/dependency-failure.js';
import { createDatabase } from '../database.js';

describe('postgres outage, with no service running', () => {
  it('fails a query on a closed port with an error the classifier accepts', async () => {
    const database = createDatabase({
      DATABASE_URL: 'postgresql://app:secret-pw@127.0.0.1:1/app',
    });

    const error = await database.db
      .execute(sql`select 1`)
      .then(() => undefined)
      .catch((caught: unknown) => caught);
    await database.close();

    expect(error).toBeDefined();
    expect(isDependencyOutage(error)).toBe(true);
  });

  it('fails the probe on a closed port', async () => {
    const database = createDatabase({
      DATABASE_URL: 'postgresql://app:secret-pw@127.0.0.1:1/app',
    });

    const error = await database.probe().catch((caught: unknown) => caught);
    await database.close();

    expect(isDependencyOutage(error)).toBe(true);
  });
});
