CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"logical_key" text NOT NULL,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"head_sha" text NOT NULL,
	"task" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_logical_scope" UNIQUE("organisation_id","repository_id","logical_key"),
	CONSTRAINT "assessment_identity_scope" UNIQUE("id","organisation_id","repository_id"),
	CONSTRAINT "assessment_status" CHECK ("assessments"."status" in ('queued','running','completed','dead_letter')),
	CONSTRAINT "assessment_attempts" CHECK ("assessments"."attempts" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_delivery_scope" UNIQUE("organisation_id","installation_id","delivery_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_assessment_id_organisation_id_repository_id_assessments_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessments"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_assessment_id_organisation_id_repository_id_assessments_id_organisation_id_repository_id_fk" FOREIGN KEY ("assessment_id","organisation_id","repository_id") REFERENCES "public"."assessments"("id","organisation_id","repository_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_ready" ON "assessments" USING btree ("organisation_id","repository_id","status","available_at");