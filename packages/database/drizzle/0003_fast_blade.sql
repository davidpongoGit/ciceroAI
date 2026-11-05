CREATE TABLE "dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"feature_id" uuid NOT NULL,
	"dependency_key" text NOT NULL,
	"revision" integer NOT NULL,
	"dependency" jsonb NOT NULL,
	"source_version_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dependency_revision" UNIQUE("feature_id","dependency_key","revision")
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"head_sha" text NOT NULL,
	"dependencies_complete" boolean DEFAULT false NOT NULL,
	CONSTRAINT "feature_key_scope" UNIQUE("organisation_id","repository_id","feature_key"),
	CONSTRAINT "feature_identity_scope" UNIQUE("id","organisation_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_feature_id_organisation_id_repository_id_features_id_organisation_id_repository_id_fk" FOREIGN KEY ("feature_id","organisation_id","repository_id") REFERENCES "public"."features"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_source_version_id_organisation_id_repository_id_source_versions_id_organisation_id_repository_id_fk" FOREIGN KEY ("source_version_id","organisation_id","repository_id") REFERENCES "public"."source_versions"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invalidations" ADD CONSTRAINT "invalidations_source_record_id_organisation_id_repository_id_source_records_id_organisation_id_repository_id_fk" FOREIGN KEY ("source_record_id","organisation_id","repository_id") REFERENCES "public"."source_records"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dependency_active" ON "dependencies" USING btree ("feature_id","active");