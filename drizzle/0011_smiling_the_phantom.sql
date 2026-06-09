ALTER TABLE "bills" ADD COLUMN "amount_credited" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "source_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "payments_received" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "payments_received" ADD COLUMN "exchange_rate" numeric(15, 6);