ALTER TABLE "stations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "stations" CASCADE;--> statement-breakpoint
ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "menu_items_station_id_stations_id_fk";
--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_station_id_stations_id_fk";
--> statement-breakpoint
ALTER TABLE "printers" DROP CONSTRAINT IF EXISTS "printers_station_id_stations_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_station_id_stations_id_fk";
--> statement-breakpoint
DROP INDEX "order_items_station_status_idx";--> statement-breakpoint
CREATE INDEX "order_items_category_status_idx" ON "order_items" USING btree ("category_id","status");--> statement-breakpoint
ALTER TABLE "menu_items" DROP COLUMN "station_id";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "station_id";--> statement-breakpoint
ALTER TABLE "printers" DROP COLUMN "station_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "station_id";