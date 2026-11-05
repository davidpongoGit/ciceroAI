CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"raw_event_days" integer DEFAULT 14 NOT NULL,
	"artifact_max_days" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "retention_scope" UNIQUE("organisation_id","repository_id"),
	CONSTRAINT "retention_days" CHECK ("retention_policies"."raw_event_days" between 1 and 365 and "retention_policies"."artifact_max_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "manual_replays" integer DEFAULT 0 NOT NULL;