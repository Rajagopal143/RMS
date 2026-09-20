ALTER TABLE "orders" ALTER COLUMN "tax" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "menu_items" DROP COLUMN "tax_percent";--> statement-breakpoint
-- Tax is no longer charged: open bills drop it too. Completed bills keep what the customer paid.
UPDATE "orders" SET "tax" = 0, "total" = "subtotal" - "discount" WHERE "status" NOT IN ('completed', 'cancelled');
