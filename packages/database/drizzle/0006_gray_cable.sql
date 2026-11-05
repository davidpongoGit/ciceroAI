CREATE TABLE "artifact_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"assessment_id" uuid,
	"reference" jsonb NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_state" CHECK ("artifact_refs"."state" in ('active','delete_pending','expired','deleted'))
);
--> statement-breakpoint
ALTER TABLE "artifact_refs" ADD CONSTRAINT "artifact_refs_assessment_id_organisation_id_repository_id_assessment_reports_assessment_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessment_reports"("assessment_id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;