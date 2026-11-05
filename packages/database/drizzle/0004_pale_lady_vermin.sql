CREATE TABLE "assertion_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"criterion_id" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"asset_key" text NOT NULL,
	"revision_sha" text NOT NULL,
	"file_hash" text NOT NULL,
	"asset" jsonb NOT NULL,
	CONSTRAINT "asset_version_scope" UNIQUE("organisation_id","repository_id","asset_key","revision_sha","file_hash")
);
--> statement-breakpoint
ALTER TABLE "assertion_mappings" ADD CONSTRAINT "assertion_mappings_assessment_id_organisation_id_repository_id_assessment_reports_assessment_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessment_reports"("assessment_id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_assessment_id_organisation_id_repository_id_assessment_reports_assessment_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessment_reports"("assessment_id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;