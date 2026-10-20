CREATE TABLE "announcement" (
	"id" text PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"summary" text NOT NULL,
	"content" text NOT NULL,
	"category" varchar(50) DEFAULT 'feature' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"target_audience" varchar(20) DEFAULT 'all' NOT NULL,
	"link" text,
	"publication_mode" varchar(20) DEFAULT 'hybrid' NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_block" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" varchar(60) NOT NULL,
	"blocked_until" timestamp NOT NULL,
	"reason" varchar(100) NOT NULL,
	"violation_count" integer DEFAULT 1 NOT NULL,
	"last_violation_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_quota_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" varchar(60) NOT NULL,
	"status" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_quota_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" varchar(60) NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_block" ADD CONSTRAINT "feature_block_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_quota_ledger" ADD CONSTRAINT "feature_quota_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_quota_usage" ADD CONSTRAINT "feature_quota_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_status_pub_idx" ON "announcement" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_block_user_feat_idx" ON "feature_block" USING btree ("user_id","feature");--> statement-breakpoint
CREATE INDEX "quota_ledger_user_feat_idx" ON "feature_quota_ledger" USING btree ("user_id","feature","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_quota_user_window_idx" ON "feature_quota_usage" USING btree ("user_id","feature","window_start");