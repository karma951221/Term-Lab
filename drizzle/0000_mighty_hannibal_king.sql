CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "code_sequences" (
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "code_sequences_kind_scope_pk" PRIMARY KEY("kind","scope")
);
--> statement-breakpoint
CREATE TABLE "discriminators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"level" text,
	"always_exposed" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scalar_type" jsonb,
	"default_value" jsonb,
	"const_value" text,
	"expression" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "discriminators_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "enum_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enum_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "enums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "enums_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "struct_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discriminator_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"type" jsonb NOT NULL,
	"default_value" jsonb,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"mode" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"body" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"required_discriminators" jsonb NOT NULL,
	"required_attributes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "clauses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "benefits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_coverage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "coverages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "coverages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sub_coverages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coverage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "appendices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "appendices_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"owner_id" uuid,
	"title" text NOT NULL,
	"general_document_id" uuid,
	"tree" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "attribute_kinds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "attribute_kinds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "attribute_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"order" integer NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "clause_option_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"clause_code" text NOT NULL,
	"options" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "plan_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"axis" text NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"plan_type_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_base_contracts" (
	"product_id" uuid NOT NULL,
	"product_coverage_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "product_base_contracts_product_id_product_coverage_id_pk" PRIMARY KEY("product_id","product_coverage_id")
);
--> statement-breakpoint
CREATE TABLE "product_coverage_attributes" (
	"product_coverage_id" uuid NOT NULL,
	"kind_code" text NOT NULL,
	"value_code" text NOT NULL,
	CONSTRAINT "product_coverage_attributes_product_coverage_id_kind_code_pk" PRIMARY KEY("product_coverage_id","kind_code")
);
--> statement-breakpoint
CREATE TABLE "product_coverage_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_coverage_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"master_node_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_coverage_plans" (
	"product_coverage_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "product_coverage_plans_product_coverage_id_plan_id_pk" PRIMARY KEY("product_coverage_id","plan_id")
);
--> statement-breakpoint
CREATE TABLE "product_coverages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"coverage_id" uuid NOT NULL,
	"coverage_name" text NOT NULL,
	"name" text NOT NULL,
	"combination_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_plan_options" (
	"plan_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	CONSTRAINT "product_plan_options_plan_id_option_id_pk" PRIMARY KEY("plan_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "product_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"general_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "products_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "special_group_members" (
	"group_id" uuid NOT NULL,
	"product_coverage_id" uuid NOT NULL,
	CONSTRAINT "special_group_members_group_id_product_coverage_id_pk" PRIMARY KEY("group_id","product_coverage_id"),
	CONSTRAINT "special_group_members_product_coverage_id_unique" UNIQUE("product_coverage_id")
);
--> statement-breakpoint
CREATE TABLE "special_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"order" integer NOT NULL,
	"general_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "entity_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"discriminator_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "entity_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"discriminator_code" text NOT NULL,
	"field_code" text DEFAULT '' NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enum_values" ADD CONSTRAINT "enum_values_enum_id_enums_id_fk" FOREIGN KEY ("enum_id") REFERENCES "public"."enums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "struct_fields" ADD CONSTRAINT "struct_fields_discriminator_id_discriminators_id_fk" FOREIGN KEY ("discriminator_id") REFERENCES "public"."discriminators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefits" ADD CONSTRAINT "benefits_sub_coverage_id_sub_coverages_id_fk" FOREIGN KEY ("sub_coverage_id") REFERENCES "public"."sub_coverages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_coverages" ADD CONSTRAINT "sub_coverages_coverage_id_coverages_id_fk" FOREIGN KEY ("coverage_id") REFERENCES "public"."coverages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_kind_id_attribute_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."attribute_kinds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_options" ADD CONSTRAINT "plan_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_base_contracts" ADD CONSTRAINT "product_base_contracts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_base_contracts" ADD CONSTRAINT "product_base_contracts_product_coverage_id_product_coverages_id_fk" FOREIGN KEY ("product_coverage_id") REFERENCES "public"."product_coverages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_coverage_attributes" ADD CONSTRAINT "product_coverage_attributes_product_coverage_id_product_coverages_id_fk" FOREIGN KEY ("product_coverage_id") REFERENCES "public"."product_coverages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_coverage_nodes" ADD CONSTRAINT "product_coverage_nodes_product_coverage_id_product_coverages_id_fk" FOREIGN KEY ("product_coverage_id") REFERENCES "public"."product_coverages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_coverage_plans" ADD CONSTRAINT "product_coverage_plans_product_coverage_id_product_coverages_id_fk" FOREIGN KEY ("product_coverage_id") REFERENCES "public"."product_coverages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_coverage_plans" ADD CONSTRAINT "product_coverage_plans_plan_id_product_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."product_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_coverages" ADD CONSTRAINT "product_coverages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_plan_options" ADD CONSTRAINT "product_plan_options_plan_id_product_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."product_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_plan_options" ADD CONSTRAINT "product_plan_options_option_id_plan_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."plan_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_plans" ADD CONSTRAINT "product_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_group_members" ADD CONSTRAINT "special_group_members_group_id_special_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."special_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_group_members" ADD CONSTRAINT "special_group_members_product_coverage_id_product_coverages_id_fk" FOREIGN KEY ("product_coverage_id") REFERENCES "public"."product_coverages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_groups" ADD CONSTRAINT "special_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enum_values_owner_code" ON "enum_values" USING btree ("enum_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "struct_fields_owner_code" ON "struct_fields" USING btree ("discriminator_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "benefits_sibling_name" ON "benefits" USING btree ("sub_coverage_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_coverages_sibling_name" ON "sub_coverages" USING btree ("coverage_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_owner" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_values_owner_code" ON "attribute_values" USING btree ("kind_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "clause_option_overrides_key" ON "clause_option_overrides" USING btree ("scope_kind","scope_id","node_id","clause_code");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_options_axis_number" ON "plan_options" USING btree ("product_id","axis","number");--> statement-breakpoint
CREATE UNIQUE INDEX "product_coverage_nodes_master" ON "product_coverage_nodes" USING btree ("product_coverage_id","master_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_coverages_combination" ON "product_coverages" USING btree ("product_id","combination_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_plans_key" ON "product_plans" USING btree ("product_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_attachments_key" ON "entity_attachments" USING btree ("owner_kind","owner_id","discriminator_code");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_values_slot" ON "entity_values" USING btree ("owner_kind","owner_id","discriminator_code","field_code");