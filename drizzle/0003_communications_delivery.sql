ALTER TABLE "announcement"
  ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp,
  ADD COLUMN IF NOT EXISTS "scheduled_delivery_mode" varchar(20),
  ADD COLUMN IF NOT EXISTS "notification_channels" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "announcement" ALTER COLUMN "publication_mode" SET DEFAULT 'IN_APP_ONLY';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_scheduled_idx"
  ON "announcement" ("status", "scheduled_at");
--> statement-breakpoint
ALTER TABLE "notification_preference"
  ADD COLUMN IF NOT EXISTS "editorial_email_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "editorial_push_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "transactional_email_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "transactional_push_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcement_read" (
  "id" text PRIMARY KEY NOT NULL,
  "announcement_id" text NOT NULL REFERENCES "announcement"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "read_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_read_user_uq"
  ON "announcement_read" ("user_id", "announcement_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_read_user_idx"
  ON "announcement_read" ("user_id", "read_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_delivery" (
  "id" text PRIMARY KEY NOT NULL,
  "announcement_id" text REFERENCES "announcement"("id") ON DELETE SET NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "category" varchar(20) NOT NULL,
  "channel" varchar(20) NOT NULL,
  "provider" varchar(30) NOT NULL,
  "provider_transaction_id" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "error_code" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_announcement_idx"
  ON "notification_delivery" ("announcement_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_user_idx"
  ON "notification_delivery" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_status_idx"
  ON "notification_delivery" ("status", "created_at");
