ALTER TYPE "public"."item_type" ADD VALUE 'other_charge';--> statement-breakpoint
ALTER TYPE "public"."item_type" ADD VALUE 'discount';--> statement-breakpoint
ALTER TYPE "public"."item_type" ADD VALUE 'subtotal';--> statement-breakpoint
ALTER TYPE "public"."item_type" ADD VALUE 'payment';--> statement-breakpoint
ALTER TYPE "public"."item_type" ADD VALUE 'sales_tax';--> statement-breakpoint
CREATE TABLE "item_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_receipt_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text,
	"quantity" numeric(15, 4) DEFAULT '1' NOT NULL,
	"unit_cost" numeric(15, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"line_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"date" timestamp NOT NULL,
	"reference" varchar(100),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"memo" text,
	"converted_bill_id" uuid,
	"posted_entry_id" uuid,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pay_date" timestamp NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" varchar(50) NOT NULL,
	"pretax" boolean DEFAULT false NOT NULL,
	"expense_account_id" uuid,
	"liability_account_id" uuid,
	"calc_basis" varchar(20),
	"default_rate" numeric(15, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"assembly_item_id" uuid NOT NULL,
	"quantity" numeric(15, 4) NOT NULL,
	"date" timestamp NOT NULL,
	"memo" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "paycheck_lines" ADD COLUMN "payroll_item_id" uuid;--> statement-breakpoint
ALTER TABLE "paychecks" ADD COLUMN "pay_run_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "quantity_invoiced" numeric(15, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "item_receipt_lines" ADD CONSTRAINT "item_receipt_lines_item_receipt_id_item_receipts_id_fk" FOREIGN KEY ("item_receipt_id") REFERENCES "public"."item_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_receipt_lines" ADD CONSTRAINT "item_receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_converted_bill_id_bills_id_fk" FOREIGN KEY ("converted_bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_liability_account_id_accounts_id_fk" FOREIGN KEY ("liability_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_builds" ADD CONSTRAINT "pending_builds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_builds" ADD CONSTRAINT "pending_builds_assembly_item_id_items_id_fk" FOREIGN KEY ("assembly_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paycheck_lines" ADD CONSTRAINT "paycheck_lines_payroll_item_id_payroll_items_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paychecks" ADD CONSTRAINT "paychecks_pay_run_id_pay_runs_id_fk" FOREIGN KEY ("pay_run_id") REFERENCES "public"."pay_runs"("id") ON DELETE no action ON UPDATE no action;