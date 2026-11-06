# Aurex Backend

Backend API for **Aurex**, Saora's mathematics-focused conversational assistant.

- Runtime: Node.js 22.21+
- Framework: NestJS 11 / TypeScript
- Database: PostgreSQL (Neon) with Drizzle ORM
- Authentication: Better Auth
- Speech: Azure AI Speech (STT + TTS), backend only
- Deployment target: Render
- Repository: https://github.com/SaoraTech/aurex-back

Aurex helps learners understand mathematical concepts, follow rigorous explanations and improve independent reasoning. The backend provides authenticated APIs, plan enforcement, conversational AI, speech endpoints and operational controls for Aurex clients.

## Architecture

~~~text
Mobile / Web / Desktop clients
            |
       HTTPS / REST
            |
     Aurex Backend (NestJS)
       |       |       |
   Better   Plans &  Feature
    Auth    Billing  Quotas
       |       |       |
       +-------+-------+
               |
     +---------+-----------+
     |         |           |
    Groq           Azure AI Speech
   (LLM)              (STT + TTS)
               |
        Neon PostgreSQL
~~~

Provider credentials are held by the backend. Client applications must never receive Azure, Groq, database or payment-provider secrets.

## Speech integration

Azure AI Speech is the **single provider** for both speech-to-text and text-to-speech.

- STT: POST /api/v1/audio/transcriptions?languageCode=fr|en, with raw audio bytes in the request body.
- TTS: POST /api/v1/audio/speech, JSON body with text and optional languageCode; response is an audio stream.
- TTS voice selection and output format are controlled by backend environment variables.
- Mathematical notation is normalized before synthesis; raw LaTeX is not sent as-is.
- Audio is processed in memory. No audio object is persisted by the speech adapter.
- There is no automatic fallback to another speech provider.

The STT adapter uses Azure Fast Transcription REST API 2025-10-15. TTS uses the regional Speech synthesis REST endpoint. Both calls have explicit timeouts and typed provider errors.

### Subscription quotas

Current default daily policies:

| Plan | STT requests/day | TTS characters/day |
|---|---:|---:|
| Free | 5 | 5,000 |
| Plus | 30 | 30,000 |
| Pro | 100 | 100,000 |
| Plus promo | 30 | 30,000 |
| Pro promo | 100 | 100,000 |

TTS is reserved by normalized character count. STT is reserved by request count; actual recognized audio duration is also recorded for cost observability. Azure STT cost estimates remain unknown until a regional unit price is configured. Plan resolution is performed server-side.

## Environment

Copy .env.example to .env. To enable speech, configure AZURE_SPEECH_ENABLED=true, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION and AZURE_SPEECH_RESOURCE_NAME.

Optional voice, timeout, text-length, audio-size and output-format settings are documented in docs/INTEGRATIONS.md and .env.example.

Never commit .env or expose the Azure key in a client application. The retired ELEVENLABS_* variables are no longer read by the backend. Remove the old variable from Render and revoke its key in the ElevenLabs console.

## Getting started

~~~bash
npm ci
cp .env.example .env
npm run start:dev
~~~

Before running against a database, verify DATABASE_URL. Do not run migrations against production without reviewing SQL and confirming the target database.

## Validation

~~~bash
npm test -- --runInBand
npm run build
npm run lint
~~~

Passing unit tests do not prove that Azure credentials, region, quotas, network access or deployed endpoints work. Perform live speech smoke tests in docs/PRODUCTION_CHECKLIST.md before enabling speech for users.

## Documentation

- docs/API.md — API route contracts.
- docs/ARCHITECTURE.md — backend architecture and request lifecycle.
- docs/INTEGRATIONS.md — provider configuration, speech behavior and limitations.
- docs/AUDIT.md — audit history and current migration addendum.
- docs/PRODUCTION_CHECKLIST.md — production validation checklist.
- README_INTEGRATION.md — speech-provider migration record.

The billing module and its payment-provider configuration are independent of this speech-provider migration.
