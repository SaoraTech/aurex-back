# Aurex API V1

Base path: `/api/v1`. Authentication routes: `/api/auth/*` (Better Auth).

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Liveness | No |
| GET | `/health/ready` | PostgreSQL readiness | No |
| GET | `/plans` | Configured plan display | No |
| GET/POST | `/conversations` | List/create conversations | Yes |
| GET | `/conversations/:id/messages` | Messages owned by user | Yes |
| DELETE | `/conversations/:id` | Delete owned conversation | Yes |
| POST | `/math/compute` | Wolfram calculation | Yes |
| GET | `/memory` | List memory | Yes |
| POST | `/memory` | Create memory | Yes |
| PATCH/DELETE | `/memory/:id` | Update/delete memory | Yes |
| GET/POST | `/artifacts` | List/create versioned artifacts | Yes |
| GET/POST | `/artifacts/:id/versions` | List/append versions | Yes |
| GET | `/identity` | Official identity, honest capability/provider states | No |
| POST | `/chat/messages` | Body adds `webSearch: off\|on\|auto`; response adds `webSearch`, `fallbackFrom`, `model` | Yes |
| POST | `/audio/speech` | Text → `audio/mpeg` (voice/model server-side) | Yes |
| POST | `/audio/transcriptions?languageCode=` | Raw audio bytes → `{ text, languageCode, provider, fallback }` | Yes |
| POST | `/research/search` | Web search (Tavily), no LLM | Yes |
| POST | `/research/deep` | Bounded deep research with citations | Yes |
| POST | `/library/documents` | Raw bytes + `X-File-Content-Type`, `X-File-Name` | Yes |
| GET | `/library/documents` · `/library/documents/:id` | List / metadata | Yes |
| GET | `/library/documents/:id/download-url` | Short-lived presigned link | Yes |
| DELETE | `/library/documents/:id` | Delete object + record | Yes |
| GET | `/metrics` | Prometheus text (404 unless `METRICS_TOKEN`) | Bearer token |
| GET | `/billing/history` | Payment history | Yes |
| POST | `/billing/checkout` | Checkout (disabled until adapter approved) | Yes |
| GET | `/privacy/export` | Export user data JSON | Yes |
| POST | `/privacy/delete-account` | Register deletion request | Yes |

Send `Idempotency-Key` on checkout requests. Current payment route deliberately refuses checkout until a validated provider adapter exists.

For native clients, test Better Auth's Bearer plugin with actual Android and iOS networking code and store tokens in Android Keystore / iOS Keychain. Do not store long-lived tokens in plain preferences or local storage.

## Error contract (changed)
All errors: `{ statusCode, error, code, message, details?, requestId }` (`statusCode`/`message` stay Nest-compatible; `code` is stable and machine-readable, e.g. `RATE_LIMITED`, `DAILY_MESSAGE_LIMIT`, `PROVIDER_TIMEOUT`, `WEB_SEARCH_UNAVAILABLE`, `UNSUPPORTED_AUDIO_TYPE`). 429/503 may carry `Retry-After`. **Clients that parse the old Nest default body must be updated.**
Idempotency: send `requestId` on `/chat/messages`; replaying it returns the stored answer without a new provider call or quota use.
