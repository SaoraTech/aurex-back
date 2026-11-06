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
   Groq              SageMath    Azure AI Speech
  (LLM)          (deterministic     (STT + TTS)
                   math)
             |
       Neon PostgreSQL
~~~

Aurex is a modular NestJS backend. Authorization, effective plan resolution and quota enforcement remain server-side. Clients never submit authoritative plan names, quotas, payment state or provider credentials.

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

## Request path

Express request context and request ID → security middleware / body limits → Nest global guards → validation pipe → controller → domain service → provider adapter → typed provider error mapping → response.

The audio transcription route is mounted with an Express raw-body parser and a configured byte limit before JSON parsing. Audio format detection is based on file signatures, not client-declared MIME values.

## Quota and usage semantics

- TTS: atomic reservation by normalized character count against tts_speech; commit on success; compensate on provider failure.
- STT: atomic reservation by transcription request against stt_transcription; commit on success; compensate on provider failure.
- STT duration is separately recorded in provider_usage as stt_seconds for cost analysis.
- The duration usage rate is intentionally unknown until a region-specific Azure price is configured.

## Client security

Native clients should store session credentials in Android Keystore / iOS Keychain. Electron should use context isolation, sandboxing, strict CSP, no Node integration in the renderer and validated IPC. No Azure or other provider secret may be embedded in a client bundle.
