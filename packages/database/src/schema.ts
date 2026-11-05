import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Installation-only technical metadata. Customer-owned domain records arrive in M1+.
export const installationMetadata = pgTable('installation_metadata', {
  id: uuid('id').primaryKey().defaultRandom(),
  formatVersion: integer('format_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    logicalKey: text('logical_key').notNull(),
    correlationId: uuid('correlation_id').notNull().defaultRandom(),
    headSha: text('head_sha').notNull(),
    task: jsonb('task').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    manualReplays: integer('manual_replays').notNull().default(0),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    result: jsonb('result'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('assessment_logical_scope').on(
      t.organisationId,
      t.repositoryId,
      t.logicalKey,
    ),
    unique('assessment_identity_scope').on(
      t.id,
      t.organisationId,
      t.repositoryId,
    ),
    index('assessment_ready').on(
      t.organisationId,
      t.repositoryId,
      t.status,
      t.availableAt,
    ),
    check(
      'assessment_status',
      sql`${t.status} in ('queued','running','completed','dead_letter')`,
    ),
    check('assessment_attempts', sql`${t.attempts} between 0 and 3`),
  ],
);

export const inboundEvents = pgTable(
  'inbound_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    installationId: text('installation_id').notNull(),
    deliveryId: text('delivery_id').notNull(),
    sourceHash: text('source_hash').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    metadata: jsonb('metadata').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('event_delivery_scope').on(
      t.organisationId,
      t.installationId,
      t.deliveryId,
    ),
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessments.id,
        assessments.organisationId,
        assessments.repositoryId,
      ],
    }),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessments.id,
        assessments.organisationId,
        assessments.repositoryId,
      ],
    }),
  ],
);

export const sourceRecords = pgTable(
  'source_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    sourceKey: text('source_key').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    unique('source_record_scope_key').on(
      t.organisationId,
      t.repositoryId,
      t.sourceKey,
    ),
    unique('source_record_identity_scope').on(
      t.id,
      t.organisationId,
      t.repositoryId,
    ),
  ],
);

export const features = pgTable(
  'features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    featureKey: text('feature_key').notNull(),
    headSha: text('head_sha').notNull(),
    dependenciesComplete: boolean('dependencies_complete')
      .notNull()
      .default(false),
  },
  (t) => [
    unique('feature_key_scope').on(
      t.organisationId,
      t.repositoryId,
      t.featureKey,
    ),
    unique('feature_identity_scope').on(t.id, t.organisationId, t.repositoryId),
  ],
);
export const dependencies = pgTable(
  'dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    featureId: uuid('feature_id').notNull(),
    dependencyKey: text('dependency_key').notNull(),
    revision: integer('revision').notNull(),
    dependency: jsonb('dependency').notNull(),
    sourceVersionId: uuid('source_version_id').notNull(),
    active: boolean('active').notNull().default(true),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('dependency_revision').on(t.featureId, t.dependencyKey, t.revision),
    index('dependency_active').on(t.featureId, t.active),
    foreignKey({
      columns: [t.featureId, t.organisationId, t.repositoryId],
      foreignColumns: [
        features.id,
        features.organisationId,
        features.repositoryId,
      ],
    }),
    foreignKey({
      columns: [t.sourceVersionId, t.organisationId, t.repositoryId],
      foreignColumns: [
        sourceVersions.id,
        sourceVersions.organisationId,
        sourceVersions.repositoryId,
      ],
    }),
  ],
);
export const invalidations = pgTable(
  'invalidations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    sourceRecordId: uuid('source_record_id').notNull(),
    reason: text('reason').notNull(),
    featureId: uuid('feature_id'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.sourceRecordId, t.organisationId, t.repositoryId],
      foreignColumns: [
        sourceRecords.id,
        sourceRecords.organisationId,
        sourceRecords.repositoryId,
      ],
    }),
  ],
);

export const testAssets = pgTable(
  'test_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    assetKey: text('asset_key').notNull(),
    revisionSha: text('revision_sha').notNull(),
    fileHash: text('file_hash').notNull(),
    asset: jsonb('asset').notNull(),
  },
  (t) => [
    unique('asset_version_scope').on(
      t.organisationId,
      t.repositoryId,
      t.assetKey,
      t.revisionSha,
      t.fileHash,
    ),
  ],
);
export const assertionMappings = pgTable(
  'assertion_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    criterionId: text('criterion_id').notNull(),
    mapping: jsonb('mapping').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessmentReports.assessmentId,
        assessmentReports.organisationId,
        assessmentReports.repositoryId,
      ],
    }),
  ],
);
export const runEvidence = pgTable(
  'run_evidence',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    evidence: jsonb('evidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessmentReports.assessmentId,
        assessmentReports.organisationId,
        assessmentReports.repositoryId,
      ],
    }),
  ],
);

export const testPlans = pgTable(
  'test_plans',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    featureId: uuid('feature_id').notNull(),
    planHash: text('plan_hash').notNull(),
    plan: jsonb('plan').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('plan_identity_scope').on(t.id, t.organisationId, t.repositoryId),
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessmentReports.assessmentId,
        assessmentReports.organisationId,
        assessmentReports.repositoryId,
      ],
    }),
    foreignKey({
      columns: [t.featureId, t.organisationId, t.repositoryId],
      foreignColumns: [
        features.id,
        features.organisationId,
        features.repositoryId,
      ],
    }),
  ],
);
export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    planId: uuid('plan_id').notNull(),
    planHash: text('plan_hash').notNull(),
    decision: text('decision').notNull(),
    actor: text('actor').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.planId, t.organisationId, t.repositoryId],
      foreignColumns: [
        testPlans.id,
        testPlans.organisationId,
        testPlans.repositoryId,
      ],
    }),
    check(
      'approval_decision_kind',
      sql`${t.decision} in ('approved','rejected','revoked')`,
    ),
  ],
);
export const governanceEvents = pgTable('governance_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull(),
  repositoryId: text('repository_id').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  targetId: text('target_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const artifactRefs = pgTable(
  'artifact_refs',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    assessmentId: uuid('assessment_id'),
    reference: jsonb('reference').notNull(),
    state: text('state').notNull().default('active'),
    legalHold: boolean('legal_hold').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessmentReports.assessmentId,
        assessmentReports.organisationId,
        assessmentReports.repositoryId,
      ],
    }),
    check(
      'artifact_state',
      sql`${t.state} in ('active','delete_pending','expired','deleted')`,
    ),
  ],
);

export const budgetAccounts = pgTable(
  'budget_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    period: text('period').notNull(),
    maxRunnerMs: integer('max_runner_ms').notNull().default(120000),
    usedRunnerMs: integer('used_runner_ms').notNull().default(0),
    reservedRunnerMs: integer('reserved_runner_ms').notNull().default(0),
  },
  (t) => [
    unique('budget_scope_period').on(
      t.organisationId,
      t.repositoryId,
      t.period,
    ),
    check(
      'budget_nonnegative',
      sql`${t.maxRunnerMs}>=0 and ${t.usedRunnerMs}>=0 and ${t.reservedRunnerMs}>=0`,
    ),
  ],
);
export const actionRuns = pgTable(
  'action_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    planId: uuid('plan_id').notNull(),
    period: text('period').notNull(),
    token: uuid('token').notNull(),
    status: text('status').notNull().default('reserved'),
    reservedMs: integer('reserved_ms').notNull(),
    actualMs: integer('actual_ms'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('action_once_per_plan').on(t.planId),
    foreignKey({
      columns: [t.planId, t.organisationId, t.repositoryId],
      foreignColumns: [
        testPlans.id,
        testPlans.organisationId,
        testPlans.repositoryId,
      ],
    }),
    check(
      'action_run_status',
      sql`${t.status} in ('reserved','completed','failed','cancelled')`,
    ),
  ],
);
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    kind: text('kind').notNull(),
    targetId: text('target_id').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('notification_scope_key').on(
      t.organisationId,
      t.repositoryId,
      t.dedupeKey,
    ),
  ],
);
export const readinessSnapshots = pgTable(
  'readiness_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    featureId: uuid('feature_id').notNull(),
    causeId: uuid('cause_id').notNull(),
    readiness: jsonb('readiness').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('readiness_cause_once').on(t.featureId, t.causeId),
    foreignKey({
      columns: [t.featureId, t.organisationId, t.repositoryId],
      foreignColumns: [
        features.id,
        features.organisationId,
        features.repositoryId,
      ],
    }),
  ],
);
export const dataJobs = pgTable('data_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull(),
  repositoryId: text('repository_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  actor: text('actor').notNull(),
  resultHash: text('result_hash'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const scopeControls = pgTable(
  'scope_controls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    phase: text('phase').notNull().default('active'),
  },
  (t) => [
    unique('scope_control_identity').on(t.organisationId, t.repositoryId),
    check(
      'scope_control_phase',
      sql`${t.phase} in ('active','deleting','deleted')`,
    ),
  ],
);
export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    rawEventDays: integer('raw_event_days').notNull().default(14),
    artifactMaxDays: integer('artifact_max_days').notNull().default(30),
  },
  (t) => [
    unique('retention_scope').on(t.organisationId, t.repositoryId),
    check(
      'retention_days',
      sql`${t.rawEventDays} between 1 and 365 and ${t.artifactMaxDays} between 1 and 365`,
    ),
  ],
);
export const sourceVersions = pgTable(
  'source_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: uuid('source_record_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    version: text('version').notNull(),
    contentHash: text('content_hash').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('source_version_dedupe').on(
      t.sourceRecordId,
      t.version,
      t.contentHash,
    ),
    unique('source_version_identity_scope').on(
      t.id,
      t.organisationId,
      t.repositoryId,
    ),
    index('source_version_current').on(t.sourceRecordId, t.isCurrent),
    foreignKey({
      columns: [t.sourceRecordId, t.organisationId, t.repositoryId],
      foreignColumns: [
        sourceRecords.id,
        sourceRecords.organisationId,
        sourceRecords.repositoryId,
      ],
    }),
  ],
);
export const assessmentReports = pgTable(
  'assessment_reports',
  {
    assessmentId: uuid('assessment_id').primaryKey(),
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    report: jsonb('report').notNull(),
    stale: boolean('stale').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('report_identity_scope').on(
      t.assessmentId,
      t.organisationId,
      t.repositoryId,
    ),
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessments.id,
        assessments.organisationId,
        assessments.repositoryId,
      ],
    }),
  ],
);
export const reportSources = pgTable(
  'report_sources',
  {
    organisationId: uuid('organisation_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    assessmentId: uuid('assessment_id').notNull(),
    sourceVersionId: uuid('source_version_id').notNull(),
  },
  (t) => [
    unique('report_source_once').on(t.assessmentId, t.sourceVersionId),
    foreignKey({
      columns: [t.assessmentId, t.organisationId, t.repositoryId],
      foreignColumns: [
        assessmentReports.assessmentId,
        assessmentReports.organisationId,
        assessmentReports.repositoryId,
      ],
    }),
    foreignKey({
      columns: [t.sourceVersionId, t.organisationId, t.repositoryId],
      foreignColumns: [
        sourceVersions.id,
        sourceVersions.organisationId,
        sourceVersions.repositoryId,
      ],
    }),
  ],
);
