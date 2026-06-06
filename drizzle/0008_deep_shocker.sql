CREATE TABLE "assembly_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"assembly_item_id" uuid NOT NULL,
	"component_item_id" uuid NOT NULL,
	"quantity" numeric(15, 4) DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rate_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tax_rate_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"agency_id" uuid,
	"rate" numeric(9, 6) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "class_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "unit_of_measure" varchar(50);--> statement-breakpoint
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_assembly_item_id_items_id_fk" FOREIGN KEY ("assembly_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_component_item_id_items_id_fk" FOREIGN KEY ("component_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate_components" ADD CONSTRAINT "tax_rate_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate_components" ADD CONSTRAINT "tax_rate_components_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate_components" ADD CONSTRAINT "tax_rate_components_agency_id_tax_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."tax_agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;