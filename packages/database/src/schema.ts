import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

// Installation-only technical metadata. Customer-owned domain records arrive in M1+.
export const installationMetadata = pgTable('installation_metadata', {
  id: uuid('id').primaryKey().defaultRandom(),
  formatVersion: integer('format_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
