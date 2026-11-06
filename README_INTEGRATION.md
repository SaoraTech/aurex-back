# Aurex Backend — Azure AI Speech migration

**Status:** implementation committed to main; live Azure credentials and production smoke tests are still required.

This document records the migration from ElevenLabs to Azure AI Speech. Azure is the only speech provider in the backend. Groq remains the LLM provider. SMP is planned as the deterministic mathematical platform but is not implemented or operational yet. It is not used as a speech fallback.

## 1. Implementation

- Added src/audio/azure-speech.service.ts as the Azure adapter.
- Updated AudioService and AudioModule to inject the Azure adapter.
- Removed src/audio/elevenlabs.service.ts.
- Replaced ElevenLabs environment schema entries with Azure Speech settings.
- Updated the audio controller to accept only fr or en as language codes.
- Preserved authenticated routes, Arcjet protection, raw-body handling, upload-size checks and byte-signature detection.
- Added usage tracking for STT calls and recognized duration seconds.
- Replaced ElevenLabs-specific audio unit tests with Azure-oriented service tests.

No Azure SDK dependency is required: the backend uses Node.js 22 built-in fetch, FormData and Blob.

## 2. Azure API behavior

### Speech-to-text

POST /api/v1/audio/transcriptions?languageCode=fr

- Request body: raw audio bytes.
- File type is identified from its signature, not trusted from a client-supplied MIME header.
- Microsoft's current Fast Transcription documentation lists WAV, MP3, OPUS/OGG, FLAC, WMA, AAC, AMR, WebM and SPEEX among supported formats.
- Backend upload limit: AUDIO_MAX_UPLOAD_BYTES (20 MiB by default).
- Calls Azure Fast Transcription API version 2025-10-15.
- Response includes text, languageCode, durationMilliseconds, provider and fallback.

### Text-to-speech

POST /api/v1/audio/speech

Request JSON:
~~~json
{ "text": "Bonjour.", "languageCode": "fr" }
~~~

- Returns an audio stream.
- French default voice: fr-FR-DeniseNeural.
- English default voice: en-US-JennyNeural.
- Voice IDs and MP3 output format are server-configured.
- normalizeForSpeech converts supported mathematical notation before SSML is built.
- SSML text and voice attributes are XML-escaped.

## 3. Environment configuration

Required when enabled:

~~~dotenv
AZURE_SPEECH_ENABLED=true
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
AZURE_SPEECH_RESOURCE_NAME=
~~~

Optional:
- AZURE_SPEECH_TIMEOUT_MS=30000
- AZURE_SPEECH_MAX_TEXT_CHARS=5000
- AZURE_SPEECH_TTS_VOICE_FR=fr-FR-DeniseNeural
- AZURE_SPEECH_TTS_VOICE_EN=en-US-JennyNeural
- AZURE_SPEECH_TTS_OUTPUT_FORMAT=audio-16khz-128kbitrate-mono-mp3
- AUDIO_DEFAULT_LANGUAGE=fr
- AUDIO_MAX_UPLOAD_BYTES=20971520

The Azure key belongs only in Render's backend environment settings or a local untracked .env. Never put it in a mobile or desktop client.

## 4. Subscription quotas

The current default policies remain unchanged:

| Plan | STT requests/day | TTS characters/day |
|---|---:|---:|
| Free | 5 | 5,000 |
| Plus / Plus promo | 30 | 30,000 |
| Pro / Pro promo | 100 | 100,000 |

STT quotas count successful transcription requests, not minutes. Actual recognized duration is recorded separately as stt_seconds; no regional Azure STT price is hard-coded. TTS quota is reserved atomically by normalized character count and compensated if the provider call fails.

## 5. Retiring ElevenLabs

The application code and environment schema no longer use ElevenLabs. Operational cleanup is still required outside GitHub:

1. Remove all ELEVENLABS_* variables from the Render service environment.
2. Revoke the old API key in the ElevenLabs dashboard.
3. Configure the Azure Speech key, region and resource name in Render.
4. Keep AZURE_SPEECH_ENABLED=false until the Azure values are present and smoke tests pass.
5. Enable speech only after the live STT and TTS checks are successful.

A repository change cannot revoke a remote provider credential or change Render environment variables.

## 6. Validation still required

- Install dependencies and run the real Jest suite.
- Run npm run build and npm run lint.
- Test French and English STT with real WebM/MP3/WAV samples.
- Test French and English TTS and verify returned audio content type.
- Verify quota exhaustion, provider timeout, invalid credentials and provider error handling.
- Confirm Azure resource region and Fast Transcription availability.
- Review actual Azure usage and regional prices before production rollout.

The migration does not modify billing providers, subscription lifecycle logic or database schema. No manual Render deployment was invoked. If Render auto-deploy is enabled for main, GitHub pushes may trigger the configured deployment automatically.
