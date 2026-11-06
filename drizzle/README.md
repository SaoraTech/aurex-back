# Drizzle migrations

The Azure AI Speech integration uses HTTP APIs and does not require a database schema change. STT duration and TTS character usage are recorded in the existing provider_usage table; the new usage kind stt_seconds is stored in the existing kind column.

For future schema changes:
1. Review src/db/schema.ts.
2. Run npm run db:generate.
3. Review the generated SQL and migration journal.
4. Test forward migration and restore on a non-production database.
5. Apply to production only after explicit approval and backup.

Never use drizzle-kit push against production. Never run migrations against production Neon without explicit approval.
