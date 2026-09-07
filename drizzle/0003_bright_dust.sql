CREATE TABLE "product_appendices" (
	"product_id" uuid NOT NULL,
	"appendix_code" text NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "product_appendices_product_id_appendix_code_pk" PRIMARY KEY("product_id","appendix_code")
);
--> statement-breakpoint
ALTER TABLE "product_appendices" ADD CONSTRAINT "product_appendices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;