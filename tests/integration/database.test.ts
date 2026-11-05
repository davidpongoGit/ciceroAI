import { describe, expect, it } from 'vitest';
import { createDatabase, readDatabaseUrl } from '@cai/database';

describe('real PostgreSQL migration and persistence smoke', () => {
  it('applies migrations twice and round-trips synthetic metadata with rollback', async () => {
    // Intentionally fails instead of skipping when configuration or PostgreSQL is absent.
    const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
    try {
      await expect(database.migrate()).resolves.toBeUndefined();
      await expect(database.migrate()).resolves.toBeUndefined();
      await expect(database.smoke()).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  });
});
