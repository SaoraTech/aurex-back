# Aurex backend notes

- Stack: NestJS + Drizzle + Neon PostgreSQL; Node.js >= 22.21.
- Run locally: npm run start:dev; build: npm run build; tests: npm test -- --runInBand; lint: npm run lint.
- Jest config ignores .base/ to avoid duplicate package.json haste collisions.
- E2E config: test/jest-e2e.json (rootDir ..).
- Drizzle migration journal includes 0002_add_promotional_plans.
- Never run migrations against production Neon without explicit approval and SQL review.
- Speech provider is Azure AI Speech only. Adapter: src/audio/azure-speech.service.ts; do not reintroduce ElevenLabs or speech fallbacks without a product decision.
- Azure secrets are backend-only. Configure AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, AZURE_SPEECH_RESOURCE_NAME and AZURE_SPEECH_ENABLED using the environment, never source code.
- STT quota is per transcription request; measured audio duration is separately recorded as stt_seconds. TTS quota is normalized character count.
- Update all relevant Markdown documentation and tests when changing API contracts, quotas or provider configuration.
