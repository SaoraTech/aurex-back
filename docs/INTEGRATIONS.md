# Integrations: behavior, configuration and limits

## Azure AI Speech — sole speech provider

src/audio/azure-speech.service.ts is the only speech provider adapter. It handles both speech-to-text (STT) and text-to-speech (TTS). There is no ElevenLabs adapter, Groq speech adapter or automatic fallback.

### Configuration

Required when enabled:

| Variable | Purpose |
|---|---|
| AZURE_SPEECH_ENABLED | Explicit feature toggle; defaults to false |
| AZURE_SPEECH_KEY | Speech resource key; backend secret only |
| AZURE_SPEECH_REGION | Azure resource region, used for regional TTS endpoint |
| AZURE_SPEECH_RESOURCE_NAME | Speech resource name, used for Fast Transcription endpoint |

Optional settings:
- AZURE_SPEECH_TIMEOUT_MS: request timeout, default 30,000 ms.
- AZURE_SPEECH_MAX_TEXT_CHARS: effective TTS text cap, default 5,000.
- AZURE_SPEECH_TTS_VOICE_FR: default fr-FR-DeniseNeural.
- AZURE_SPEECH_TTS_VOICE_EN: default en-US-JennyNeural.
- AZURE_SPEECH_TTS_OUTPUT_FORMAT: default audio-16khz-128kbitrate-mono-mp3.
- AUDIO_DEFAULT_LANGUAGE: fr or en, default fr.
- AUDIO_MAX_UPLOAD_BYTES: default 20 MiB.

When AZURE_SPEECH_ENABLED=true, Zod requires the key, region and resource name. Keep all credentials in backend environment settings. Never expose them to mobile, desktop or web clients.

### STT flow

The backend sends a multipart request to:

https://{resourceName}.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15

The request contains the raw audio file and a JSON definition with locale fr-FR or en-US. Azure Fast Transcription supports several container/codecs, including WAV, MP3, OPUS/OGG, FLAC, WMA, AAC, AMR, WebM and SPEEX; Azure regional availability and limits must be verified for the selected resource.

The current API accepts raw bytes at POST /api/v1/audio/transcriptions. The backend:
- rejects empty or oversized uploads;
- detects media format from byte signatures;
- does not trust a client-supplied MIME header;
- does not write audio to disk;
- applies the user's effective subscription quota before calling Azure;
- records request count and recognized duration.

### TTS flow

The backend sends SSML to:

https://{region}.tts.speech.microsoft.com/cognitiveservices/v1

The voice is selected server-side by language. Text is normalized by normalizeForSpeech so supported mathematical expressions are spoken naturally rather than sending raw LaTeX to the voice engine. SSML text and voice attributes are XML-escaped. The response is streamed to the client with Cache-Control: no-store.

### Quotas

Default daily quota policies in src/quotas/quota-policies.ts:

| Plan | STT requests | TTS characters |
|---|---:|---:|
| Free | 5/day | 5,000/day |
| Plus | 30/day | 30,000/day |
| Plus promo | 30/day | 30,000/day |
| Pro | 100/day | 100,000/day |
| Pro promo | 100/day | 100,000/day |

The effective plan is obtained from PlansService, not from client input. STT quota is request-count based. Actual duration is tracked as stt_seconds. No Azure regional STT price is assumed; cost remains unknown until a rate is configured. TTS usage is tracked by characters; verify current Azure prices and resource tier before production rollout.

### Error handling and observability

Provider errors are normalized into safe error kinds (authentication, rate limit, quota, timeout, unavailable, invalid request, bad response). Provider response bodies, keys and user text are not logged. Metrics track provider operation outcome and latency. There are no automatic retries or alternate speech providers.

### Retiring ElevenLabs

The code and environment schema no longer reference ElevenLabs. Operational actions still required:
1. Remove ELEVENLABS_* variables from the Render environment.
2. Revoke the former key in the ElevenLabs console.
3. Configure Azure values in Render.
4. Keep the Azure feature disabled until live tests pass.

A GitHub commit cannot revoke a key held by a third-party service or edit Render environment variables.

## Groq LLM and SMP

Groq is the language-model integration. SMP is the planned deterministic mathematical platform, but it is not implemented or operational yet. Mathematical requests must not be described as formally verified. These capabilities are separate from speech.

## Plans, subscriptions and quotas

PlansService resolves the effective plan from server-side subscription state. QuotasService atomically reserves, commits or compensates feature usage. The audio migration does not change billing provider integration, payment lifecycle, subscription renewal, cancellation or upgrade behavior.

## Arcjet

Route policies are declared with @Protect(...). Authentication and route-specific protection run server-side. Configure trusted proxies when deployed behind a load balancer. Production must not silently run without the intended security configuration.

## Cloudflare R2

The bucket is private. Object ownership is enforced through database metadata, not a client-supplied object key. File signatures and plan-based size limits are checked. Malware scanning is not implemented; do not automatically execute or process uploaded documents as trusted content.

## Brave Search API — sole web-search provider

The backend uses Brave's LLM Context endpoint (POST https://api.search.brave.com/res/v1/llm/context) for AI-oriented web search. It returns ranked source URLs, titles and pre-extracted relevant passages; Aurex does not need a second extraction or scraping request.

Configuration:
- BRAVE_SEARCH_ENABLED: explicit toggle, default false.
- BRAVE_SEARCH_API_KEY: secret token sent only in the X-Subscription-Token header.
- BRAVE_SEARCH_TIMEOUT_MS: request timeout, default 30,000 ms.
- BRAVE_SEARCH_MAX_TOKENS: approximate context budget, default 8,192 (valid 1,024–32,768).
- BRAVE_SEARCH_LANGUAGE: result language, default fr.
- BRAVE_SEARCH_COUNTRY: optional two-letter country code; unset means provider default.

The adapter uses a 10-minute in-process cache (shortened for fresh/news queries), no automatic retries, bounded result counts, safe typed errors and provider-level latency metrics. Chat context uses one query. Deep research uses Groq to plan a bounded list of queries, searches each query through Brave, deduplicates URLs, then asks Groq to synthesise only the retrieved source material with citations. Web passages are treated as untrusted data and fenced before reaching the model.

The existing daily plan quotas remain unchanged. RESEARCH_MAX_SEARCHES caps deep-research query count (default 5); RESEARCH_DEADLINE_MS bounds the workflow (default 60 seconds). Search usage is recorded under provider brave_search. Tavily is no longer used or configured by Aurex.

## Observability

Structured logs and provider metrics must not contain credentials, full audio, user speech transcripts or raw user prompts. Usage records contain provider, operation kind, units, outcome, latency and request ID only.
