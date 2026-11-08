# Architecture and client support

~~~text
Mobile / Web / Desktop clients
             |
        HTTPS / REST
             |
       NestJS Backend
       |     |      |
   Better   Plans  Security
    Auth   + Quotas  Arcjet
       |     |      |
       +-----+------+
             |
    +--------+---------+-------------+
    |                  |             |
   Groq           Azure AI Speech  Neon PostgreSQL
  (LLM)              (STT + TTS)
~~~

Aurex is a modular NestJS backend. Authorization, effective plan resolution and quota enforcement remain server-side. Clients never submit authoritative plan names, quotas, payment state or provider credentials.

## Guest Mode

GuestController → Arcjet guest policy → GuestSessionService → Groq AI Orchestrator. Session bearer tokens are stored as SHA-256 digests; message context and quota counters live only in process memory and are discarded on expiry, revocation or process shutdown. This path bypasses Drizzle/Neon entirely and does not call authenticated plan, conversation, memory or quota services. See [GUEST_MODE.md](./GUEST_MODE.md) for API and scaling constraints.

## Audio module

~~~text
AudioController
  |-- RequireUserGuard
  |-- Protect('tts' | 'stt')
  |
AudioService
  |-- PlansService.getEffectivePlan(userId)
  |-- QuotasService.reserveQuota(...)
  |-- AzureSpeechService
  |     |-- STT: Fast Transcription REST API
  |     |-- TTS: regional Speech synthesis REST API
  |-- UsageService
  |-- quota commit / compensation
~~~

The Azure adapter uses Node.js 22 native fetch, FormData and Blob; no Azure SDK is bundled. Azure resource keys are read only by the backend. The speech service performs no automatic provider fallback and does not persist uploaded audio.

## Web research module

~~~text
ResearchController
  |-- WebResearchService
        |-- QuotasService / UsageService
        |-- Groq query planner (deep research only)
        |-- BraveSearchService
              |-- LLM Context REST API
              |-- URL/title/extracted snippets
        |-- Groq evidence-based synthesis
              |-- source IDs and citation validation
~~~

Brave returns query-relevant page passages with source metadata in one request. Aurex does not separately scrape or extract result URLs. Search results are untrusted input, isolated in a data fence before synthesis. No provider fallback is configured.

## Request path

Express request context and request ID → security middleware / body limits → Nest global guards (pre-auth IP gate before Better Auth lookup) → validation pipe → controller → domain service → provider adapter → typed provider error mapping → response.

The audio transcription route is mounted with an Express raw-body parser and a configured byte limit before JSON parsing. Audio format detection is based on file signatures, not client-declared MIME values.

## Quota and usage semantics

- TTS: atomic reservation by normalized character count against tts_speech; commit on success; compensate on provider failure.
- STT: atomic reservation by transcription request against stt_transcription; commit on success; compensate on provider failure.
- STT duration is separately recorded in provider_usage as stt_seconds for cost analysis.
- The duration usage rate is intentionally unknown until a region-specific Azure price is configured.

## Client security

Native clients should store session credentials in Android Keystore / iOS Keychain. Electron should use context isolation, sandboxing, strict CSP, no Node integration in the renderer and validated IPC. No Azure or other provider secret may be embedded in a client bundle.
