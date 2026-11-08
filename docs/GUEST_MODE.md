# Guest Mode — API contract and operational limits

Guest Mode lets an unauthenticated client use Groq chat without creating a Better Auth account. Guest sessions and conversation context are held only in process memory. No guest session, conversation, prompt, answer, quota counter or history row is written to Neon.

## Endpoints

All paths below are relative to `/api/v1`.

| Method | Path | Purpose | Authentication |
|---|---|---|---|
| POST | `/guest/sessions` | Create a fresh guest session | None |
| DELETE | `/guest/sessions/current` | Revoke the current guest session | Guest Bearer |
| POST | `/guest/chat/messages` | Send a message and receive the completed answer | Guest Bearer |
| POST | `/guest/chat/messages/stream` | Send a message and receive SSE delta/done/error events | Guest Bearer |

### Create session

```http
POST /api/v1/guest/sessions
```

Response includes a random 256-bit Bearer token, session ID, expiry and message quota. The raw token is returned once; only its SHA-256 digest is retained in memory by the backend.

### Send message

```http
POST /api/v1/guest/chat/messages/stream
Authorization: Bearer <guest-token>
Content-Type: application/json

{"content":"Explique la dérivée de x²."}
```

SSE events:
- `delta`: `{"delta":"..." }`
- `done`: completed assistant message, remaining quota and expiry
- `error`: stable error payload

A guest session allows one generation at a time. Context is limited by both the latest configured number of messages and a per-session character budget. Failed and interrupted generations are not committed to the context and do not consume the message quota.

## Defaults and environment variables

| Variable | Default | Bounds |
|---|---:|---:|
| `GUEST_SESSION_TTL_SECONDS` | 43,200 (12 h) | 300–86,400 |
| `GUEST_SESSION_MAX_LIFETIME_SECONDS` | 43,200 (12 h) | 300–86,400 |
| `GUEST_MESSAGE_LIMIT` | 10 successful turns | 1–100 |
| `GUEST_CONTEXT_MESSAGES` | 20 messages | 2–40 |
| `GUEST_MAX_PROMPT_CHARS` | 12,000 | 100–20,000 |
| `GUEST_MAX_ACTIVE_SESSIONS` | 2,000 | 100–10,000 |
| `GUEST_MAX_CONTEXT_CHARS` | 24,000 characters/session | 1,000–50,000 |

Guest requests use the Free Groq generation path. Guest quotas are independent from authenticated Free/Plus/Pro quotas. Web search, saved conversations, account memory, billing, audio, file storage and other account features are not exposed in Guest Mode.

## Client lifecycle

The client must keep the guest token in volatile application memory only; do not persist it to AsyncStorage, SecureStore, Keychain, localStorage, cookies or a backup. On a fresh app process, call `POST /guest/sessions` and start with an empty context. On explicit exit, call the revoke endpoint as a best-effort cleanup. A force-stop or crash cannot send a revoke request; server-side expiry is the fallback.

## Deployment and scaling constraints

- Guest state is process-local and intentionally ephemeral. A process restart, redeploy or instance termination invalidates all active guest sessions and deletes their context.
- With multiple backend replicas, requests for one guest token must be routed to the same instance (sticky routing). This implementation does not use Neon, Redis or another shared persistence layer.
- Guest traffic is protected by the dedicated Arcjet `guest` policy: Shield, bot detection, six requests per minute per IP, plus the in-memory local limiter when Arcjet is unavailable.
- Do not enable multiple replicas without session affinity or a separately approved ephemeral shared store.
- No database migration is required. No production deployment or migration was performed by this change.
