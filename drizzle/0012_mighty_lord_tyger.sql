CREATE TABLE "sales_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_receipt_id" uuid NOT NULL,
	"item_id" uuid,
	"account_id" uuid,
	"description" text,
	"quantity" numeric(15, 4) DEFAULT '1' NOT NULL,
	"rate" numeric(15, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"class_id" uuid,
	"job_id" uuid,
	"tax_rate_id" uuid,
	"line_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid,
	"receipt_number" integer NOT NULL,
	"date" timestamp NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"reference" varchar(100),
	"status" "doc_status" DEFAULT 'paid' NOT NULL,
	"class_id" uuid,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"deposit_account_id" uuid,
	"memo" text,
	"posted_entry_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_memos" ADD COLUMN "refunded_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "to_print" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments_received" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "vendor_credits" ADD COLUMN "refunded_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_receipt_lines" ADD CONSTRAINT "sales_receipt_lines_sales_receipt_id_sales_receipts_id_fk" FOREIGN KEY ("sales_receipt_id") REFERENCES "public"."sales_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipt_lines" ADD CONSTRAINT "sales_receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipt_lines" ADD CONSTRAINT "sales_receipt_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipt_lines" ADD CONSTRAINT "sales_receipt_lines_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipt_lines" ADD CONSTRAINT "sales_receipt_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipt_lines" ADD CONSTRAINT "sales_receipt_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipts" ADD CONSTRAINT "sales_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipts" ADD CONSTRAINT "sales_receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipts" ADD CONSTRAINT "sales_receipts_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipts" ADD CONSTRAINT "sales_receipts_deposit_account_id_accounts_id_fk" FOREIGN KEY ("deposit_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_receipts" ADD CONSTRAINT "sales_receipts_posted_entry_id_journal_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;