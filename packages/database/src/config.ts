import { z } from 'zod';

const DatabaseUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname.length > 0 &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
});

export function readDatabaseUrl(value: unknown): string {
  const result = DatabaseUrlSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      'DATABASE_URL must be an explicit PostgreSQL URL with a database name.',
    );
  }
  return result.data;
}
