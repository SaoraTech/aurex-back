ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'plus_promo';
--> statement-breakpoint
ALTER TYPE "public"."plan" ADD VALUE IF NOT EXISTS 'pro_promo';
--> statement-breakpoint
ALTER TABLE "feature_quota_ledger" ADD COLUMN IF NOT EXISTS "units" integer DEFAULT 1 NOT NULL;
