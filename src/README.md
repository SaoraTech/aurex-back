# Source layout

Each feature owns its controller, service and module. Keep external providers behind adapters and enforce authorization, plan resolution and quotas on the server.

## Audio

- audio.controller.ts: authenticated REST endpoints and request validation.
- audio.service.ts: plan-aware quota reservation, provider orchestration, usage recording and safe error mapping.
- azure-speech.service.ts: sole STT/TTS adapter for Azure AI Speech.
- speech-text.ts: mathematical and Markdown normalization before TTS.

Do not add provider credentials to client code. Do not persist raw audio in the speech adapter. Do not add silent speech-provider fallbacks.
