# Aurex API V1

Base path: /api/v1. Better Auth routes are mounted under /api/auth/*.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | /health | Liveness | No |
| GET | /health/ready | PostgreSQL readiness | No |
| GET | /plans | Plan display | No |
| GET/POST | /conversations | List/create conversations | Yes |
| GET | /conversations/:id/messages | List messages owned by user | Yes |
| DELETE | /conversations/:id | Delete owned conversation | Yes |
| GET/POST | /memory | List/create memory | Yes |
| PATCH/DELETE | /memory/:id | Update/delete memory | Yes |
| GET/POST | /artifacts | List/create artifacts | Yes |
| GET/POST | /artifacts/:id/versions | List/append versions | Yes |
| GET | /identity | Product identity and capability state | No |
| POST | /chat/messages | Conversational message | Yes |
| POST | /audio/speech | Azure text-to-speech | Yes |
| POST | /audio/transcriptions | Azure speech-to-text | Yes |
| POST | /research/search | Web search | Yes |
| POST | /research/deep | Bounded deep research | Yes |
| POST | /library/documents | Upload document | Yes |
| GET | /library/documents | List documents | Yes |
| GET | /library/documents/:id | Document metadata | Yes |
| GET | /library/documents/:id/download-url | Short-lived download URL | Yes |
| DELETE | /library/documents/:id | Delete document | Yes |
| GET | /metrics | Prometheus metrics, when enabled | Token |

## Audio contracts

### Text-to-speech

POST /api/v1/audio/speech

Body:
~~~json
{ "text": "Résoudre x au carré moins 4 égal zéro.", "languageCode": "fr" }
~~~

- text: required string, 1–20,000 characters at DTO level; effective spoken text is additionally capped by AZURE_SPEECH_MAX_TEXT_CHARS (default 5,000).
- languageCode: optional fr or en; defaults to AUDIO_DEFAULT_LANGUAGE.
- Success: binary audio stream, default MP3.
- Headers: Cache-Control: no-store, X-Aurex-Audio-Provider: azure-speech, X-Aurex-Audio-Fallback: false.

### Speech-to-text

POST /api/v1/audio/transcriptions?languageCode=fr

- Body: raw audio bytes, not JSON or multipart.
- languageCode: optional fr or en; defaults to AUDIO_DEFAULT_LANGUAGE.
- Type is sniffed from audio bytes; client MIME metadata is not authoritative.
- Maximum upload defaults to 20 MiB.
- Success JSON:
~~~json
{
  "text": "Bonjour, pouvez-vous m'aider ?",
  "languageCode": "fr-FR",
  "durationMilliseconds": 4200,
  "provider": "azure-speech",
  "fallback": false
}
~~~

Both routes require authentication and are protected by the tts / stt security policies. Azure credentials never leave the backend. There is no speech-provider fallback.

## Error contract

~~~json
{ "statusCode": 429, "error": "Too Many Requests", "code": "STT_QUOTA_EXCEEDED", "message": "Quota atteint.", "details": {}, "requestId": "..." }
~~~

Clients should use the stable code field rather than matching localized messages. Rate-limit responses may include Retry-After. Never send authoritative plan, price or provider configuration from the client.
