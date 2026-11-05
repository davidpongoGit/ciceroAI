import { describe, expect, it } from 'vitest';
import { readWorkflowConfig } from './workflow-config.js';
describe('workflow configuration fails closed', () => {
  it('defaults to health-only and rejects placeholder or shared credentials', () => {
    expect(readWorkflowConfig({})).toBeNull();
    const config = {
      WORKFLOW_ENABLED: 'true',
      ORGANISATION_ID: '134da1cb-a441-4325-9e17-e2c93eb12bbc',
      REPOSITORY_ID: '101',
      INSTALLATION_ID: '99',
      DATABASE_URL:
        'postgresql://synthetic:placeholder@127.0.0.1:55432/postgres',
      WEBHOOK_SECRET: 'CHANGE_ME_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
      API_TOKEN: 'synthetic-independent-token-32-characters',
    };
    expect(() => readWorkflowConfig(config)).toThrow(
      'Invalid workflow configuration',
    );
    expect(() =>
      readWorkflowConfig({ ...config, WEBHOOK_SECRET: config.API_TOKEN }),
    ).toThrow('must be different');
  });
});
