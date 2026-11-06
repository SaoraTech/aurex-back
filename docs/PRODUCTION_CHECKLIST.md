# Production readiness checklist

## Application and infrastructure

- [ ] Run npm ci, npm run build, npm test -- --runInBand and npm run lint in CI.
- [ ] Review generated Drizzle SQL and test migrations on a non-production database.
- [ ] Configure TLS, trusted origins, secure cookies, trusted proxies, secrets storage and log redaction.
- [ ] Verify authentication, session revocation, email verification and password-reset flows.
- [ ] Verify plan resolution and all feature quotas server-side.
- [ ] Test chat idempotency and concurrent quota reservations.
- [ ] Validate LLM timeouts, typed errors and cost controls. SMP computation must remain disabled until its implementation is deployed.
- [ ] Verify payment webhook signatures, idempotency, reconciliation, refunds and subscription state transitions.
- [ ] Verify private R2 bucket, ownership checks, signed URLs, MIME sniffing and size limits.
- [ ] Add malware scanning before automatically processing user documents.
- [ ] Configure monitoring, error reporting, alerts, backups and restore drills.
- [ ] Test Web, Android, iOS, React Native/Expo and Electron clients.

## Azure AI Speech rollout

- [ ] Create an Azure AI Speech resource in a region that supports Fast Transcription.
- [ ] Confirm the resource name, region and pricing tier in Azure.
- [ ] Configure AZURE_SPEECH_KEY, AZURE_SPEECH_REGION and AZURE_SPEECH_RESOURCE_NAME in the backend environment only.
- [ ] Set AZURE_SPEECH_ENABLED=false until credentials and smoke tests are ready.
- [ ] Verify French STT with a real WebM/OGG or WAV sample.
- [ ] Verify English STT with a real audio sample.
- [ ] Verify French TTS and English TTS; listen to returned MP3 and verify content type.
- [ ] Test mathematical speech normalization (fractions, powers, roots and operators).
- [ ] Test invalid audio, empty audio, upload-size rejection and maximum TTS text length.
- [ ] Test provider authentication failure, rate limit, timeout and unavailable responses.
- [ ] Test Free, Plus, Pro and promotional quota exhaustion and reservation compensation.
- [ ] Verify STT duration records and configure a regional STT rate before treating cost estimates as known.
- [ ] Review actual Azure consumption, concurrency limits and billing in Azure portal.
- [ ] Enable speech only after all checks pass.

## ElevenLabs retirement

- [ ] Remove all ELEVENLABS_* variables from the Render service environment.
- [ ] Revoke the retired ElevenLabs API key in the ElevenLabs dashboard.
- [ ] Confirm no ElevenLabs key remains in local secrets, deployment settings or secret stores.

## Deployment

- [ ] Deploy only after CI and production configuration checks pass.
- [ ] Inspect Render deployment logs and confirm health/readiness.
- [ ] Exercise authenticated STT and TTS routes against the deployed Azure resource.
- [ ] Confirm no secrets or user audio/transcripts appear in logs.

A GitHub push does not deploy Render unless deployment automation is configured. This checklist does not authorize a manual production deployment.
