ALTER TYPE "public"."item_status" ADD VALUE 'served';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'serving' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'served' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'waiter';--> statement-breakpoint
CREATE TABLE "dining_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"name" text NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "added_by" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "served_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "table_id" integer;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dining_tables_restaurant_name_idx" ON "dining_tables" USING btree ("restaurant_id","name");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_table_idx" ON "orders" USING btree ("table_id");