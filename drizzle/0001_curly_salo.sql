CREATE TABLE "naming_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "attribute_values" ADD COLUMN "fragment" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "attribute_values" DROP COLUMN "prefix";--> statement-breakpoint
ALTER TABLE "attribute_values" DROP COLUMN "suffix";