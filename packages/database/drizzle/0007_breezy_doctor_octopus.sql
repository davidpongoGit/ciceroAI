CREATE TABLE "action_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"period" text NOT NULL,
	"token" uuid NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reserved_ms" integer NOT NULL,
	"actual_ms" integer,
	"lease_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_once_per_plan" UNIQUE("plan_id"),
	CONSTRAINT "action_run_status" CHECK ("action_runs"."status" in ('reserved','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "budget_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"period" text NOT NULL,
	"max_runner_ms" integer DEFAULT 120000 NOT NULL,
	"used_runner_ms" integer DEFAULT 0 NOT NULL,
	"reserved_runner_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "budget_scope_period" UNIQUE("organisation_id","repository_id","period"),
	CONSTRAINT "budget_nonnegative" CHECK ("budget_accounts"."max_runner_ms">=0 and "budget_accounts"."used_runner_ms">=0 and "budget_accounts"."reserved_runner_ms">=0)
);
--> statement-breakpoint
CREATE TABLE "data_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"actor" text NOT NULL,
	"result_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_scope_key" UNIQUE("organisation_id","repository_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "readiness_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"feature_id" uuid NOT NULL,
	"cause_id" uuid NOT NULL,
	"readiness" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_cause_once" UNIQUE("feature_id","cause_id")
);
--> statement-breakpoint
CREATE TABLE "scope_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"phase" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "scope_control_identity" UNIQUE("organisation_id","repository_id"),
	CONSTRAINT "scope_control_phase" CHECK ("scope_controls"."phase" in ('active','deleting','deleted'))
);
--> statement-breakpoint
ALTER TABLE "invalidations" ADD COLUMN "feature_id" uuid;--> statement-breakpoint
ALTER TABLE "invalidations" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
INSERT INTO "scope_controls" ("organisation_id","repository_id") SELECT DISTINCT "organisation_id","repository_id" FROM "assessments" ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "action_runs" ADD CONSTRAINT "action_runs_plan_id_organisation_id_repository_id_test_plans_id_organisation_id_repository_id_fk" FOREIGN KEY ("plan_id","organisation_id","repository_id") REFERENCES "public"."test_plans"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_snapshots" ADD CONSTRAINT "readiness_snapshots_feature_id_organisation_id_repository_id_features_id_organisation_id_repository_id_fk" FOREIGN KEY ("feature_id","organisation_id","repository_id") REFERENCES "public"."features"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;
