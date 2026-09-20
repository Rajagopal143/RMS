ALTER TABLE "categories" ADD COLUMN "color" text DEFAULT '#2a78d6' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "category_ids" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "category_ids" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Carry existing station routing over to categories.
UPDATE "order_items" oi SET "category_id" = mi."category_id" FROM "menu_items" mi WHERE oi."menu_item_id" = mi."id";--> statement-breakpoint
UPDATE "users" u SET "category_ids" = coalesce((SELECT array_agg(DISTINCT mi."category_id") FROM "menu_items" mi WHERE mi."station_id" = u."station_id" AND mi."category_id" IS NOT NULL), '{}') WHERE u."station_id" IS NOT NULL;--> statement-breakpoint
UPDATE "printers" p SET "category_ids" = coalesce((SELECT array_agg(DISTINCT mi."category_id") FROM "menu_items" mi WHERE mi."station_id" = p."station_id" AND mi."category_id" IS NOT NULL), '{}') WHERE p."station_id" IS NOT NULL;--> statement-breakpoint
UPDATE "categories" c SET "color" = s."color" FROM (SELECT DISTINCT ON (mi."category_id") mi."category_id", st."color" FROM "menu_items" mi JOIN "stations" st ON st."id" = mi."station_id" WHERE mi."category_id" IS NOT NULL ORDER BY mi."category_id", mi."id") s WHERE s."category_id" = c."id";
