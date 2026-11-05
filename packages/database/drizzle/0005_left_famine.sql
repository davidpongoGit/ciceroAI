CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"decision" text NOT NULL,
	"actor" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decision_kind" CHECK ("approval_decisions"."decision" in ('approved','rejected','revoked'))
);
--> statement-breakpoint
CREATE TABLE "governance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_identity_scope" UNIQUE("id","organisation_id","repository_id")
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_plan_id_organisation_id_repository_id_test_plans_id_organisation_id_repository_id_fk" FOREIGN KEY ("plan_id","organisation_id","repository_id") REFERENCES "public"."test_plans"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_assessment_id_organisation_id_repository_id_assessment_reports_assessment_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessment_reports"("assessment_id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plans" ADD CONSTRAINT "test_plans_feature_id_organisation_id_repository_id_features_id_organisation_id_repository_id_fk" FOREIGN KEY ("feature_id","organisation_id","repository_id") REFERENCES "public"."features"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;