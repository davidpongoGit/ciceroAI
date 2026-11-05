import { describe, expect, it } from 'vitest';
import { readApiConfig } from './config.js';

describe('API configuration', () => {
  it('defaults to loopback and ignores unrelated environment values', () => {
    expect(readApiConfig({ UNUSED: 'ignored' })).toEqual({
      host: '127.0.0.1',
      port: 3000,
    });
    expect(readApiConfig({ PORT: '3100' }).port).toBe(3100);
  });

  it.each(['', '0', '-1', '65536', 'NaN', '3000.5'])(
    'rejects invalid port %j',
    (PORT) => {
      expect(() => readApiConfig({ PORT })).toThrow(
        'Invalid API configuration',
      );
    },
  );

  it('rejects public binding and does not echo input secrets', () => {
    expect(() => readApiConfig({ HOST: '0.0.0.0' })).toThrow(
      'HOST must be 127.0.0.1',
    );
    expect(() => readApiConfig({ PORT: 'synthetic-secret' })).not.toThrow(
      'synthetic-secret',
    );
  });
});
