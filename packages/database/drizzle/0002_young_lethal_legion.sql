CREATE TABLE "assessment_reports" (
	"assessment_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"report" jsonb NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_identity_scope" UNIQUE("assessment_id","organisation_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "report_sources" (
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	CONSTRAINT "report_source_once" UNIQUE("assessment_id","source_version_id")
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"source_key" text NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "source_record_scope_key" UNIQUE("organisation_id","repository_id","source_key"),
	CONSTRAINT "source_record_identity_scope" UNIQUE("id","organisation_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "source_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_version_dedupe" UNIQUE("source_record_id","version","content_hash"),
	CONSTRAINT "source_version_identity_scope" UNIQUE("id","organisation_id","repository_id")
);
--> statement-breakpoint
ALTER TABLE "assessment_reports" ADD CONSTRAINT "assessment_reports_assessment_id_organisation_id_repository_id_assessments_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessments"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_assessment_id_organisation_id_repository_id_assessment_reports_assessment_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessment_reports"("assessment_id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sources" ADD CONSTRAINT "report_sources_source_version_id_organisation_id_repository_id_source_versions_id_organisation_id_repository_id_fk" FOREIGN KEY ("source_version_id","organisation_id","repository_id") REFERENCES "public"."source_versions"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_versions" ADD CONSTRAINT "source_versions_source_record_id_organisation_id_repository_id_source_records_id_organisation_id_repository_id_fk" FOREIGN KEY ("source_record_id","organisation_id","repository_id") REFERENCES "public"."source_records"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_version_current" ON "source_versions" USING btree ("source_record_id","is_current");