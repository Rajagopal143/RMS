ALTER TABLE "orders" ADD COLUMN "paid_cash" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_upi" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Older bills recorded only the mode, so fill the amounts from it.
UPDATE "orders" SET "paid_cash" = "total" WHERE "payment_mode" = 'cash';--> statement-breakpoint
UPDATE "orders" SET "paid_upi" = "total" WHERE "payment_mode" = 'upi';
