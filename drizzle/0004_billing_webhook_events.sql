CREATE TABLE IF NOT EXISTS "billing_webhook_event" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" varchar(30) NOT NULL,
  "provider_event_id" text NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'received',
  "attempts" integer NOT NULL DEFAULT 0,
  "error_code" text,
  "received_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_webhook_provider_event_uq"
  ON "billing_webhook_event" ("provider", "provider_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_webhook_status_idx"
  ON "billing_webhook_event" ("status", "received_at");
