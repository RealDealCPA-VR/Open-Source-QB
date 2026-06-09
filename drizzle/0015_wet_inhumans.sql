ALTER TABLE "bill_lines" ADD COLUMN "billed_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "accruals" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "amount_invoiced" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_lines" ADD COLUMN "billed_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "quantity_billed" numeric(15, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_billed_invoice_id_invoices_id_fk" FOREIGN KEY ("billed_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_billed_invoice_id_invoices_id_fk" FOREIGN KEY ("billed_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;