import { describe, expect, it } from 'vitest';
import { readDatabaseUrl } from './config.js';

describe('database configuration', () => {
  it('requires explicit PostgreSQL configuration', () => {
    const url = 'postgresql://synthetic:placeholder@127.0.0.1:5432/cai_local';
    expect(readDatabaseUrl(url)).toBe(url);
    expect(readDatabaseUrl(url.replace('postgresql:', 'postgres:'))).toContain(
      'postgres:',
    );
  });

  it.each([
    undefined,
    '',
    'http://localhost/db',
    'postgresql://localhost/',
    'secret-value',
  ])('rejects invalid URL without echoing it: %j', (value) => {
    expect(() => readDatabaseUrl(value)).toThrow(
      'DATABASE_URL must be an explicit PostgreSQL URL',
    );
    expect(() => readDatabaseUrl(value)).not.toThrow('secret-value');
  });
});
