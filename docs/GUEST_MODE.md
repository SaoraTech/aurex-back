# Guest Mode — API contract and operational limits

Guest Mode lets an unauthenticated client use Groq chat without creating a Better Auth account. Before an authenticated import, Guest sessions and conversation context are held only in process memory. No Guest session or Guest chat turn is written to Neon; only an explicit import creates standard authenticated conversation/message rows.

## Endpoints

All paths below are relative to `/api/v1`.

| Method | Path | Purpose | Authentication |
|---|---|---|---|
| POST | `/guest/sessions` | Create a fresh guest session | None |
| DELETE | `/guest/sessions/current` | Revoke the current guest session | Guest Bearer |
| POST | `/guest/chat/messages` | Send a message and receive the completed answer | Guest Bearer |
| POST | `/guest/chat/messages/stream` | Send a message and receive SSE delta/done/error events | Guest Bearer |
| POST | `/guest/sessions/current/import` | Import the Guest transcript into the authenticated history | Better Auth + X-Guest-Session-Token |

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
| `GUEST_MESSAGE_LIMIT` | 10 successful turns | 1–10 |
| `GUEST_CONTEXT_MESSAGES` | 20 messages | 2–20 |
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


## Automatic import into an authenticated account

After Better Auth has created or resolved the account session, the mobile client automatically imports the current Guest transcript. The Guest bearer is sent in a separate header so it never overwrites Better Auth's `Authorization` header.

```http
POST /api/v1/guest/sessions/current/import
Authorization: Bearer <better-auth-session-token>
X-Guest-Session-Token: <raw-guest-token>
Content-Type: application/json
```

Cookie-based Better Auth sessions may use the authenticated `Cookie` header instead of the Better Auth Bearer token. `X-Guest-Session-Token` always contains the raw token returned by `POST /guest/sessions` (without the `Bearer ` prefix).

Request body:

```json
{
  "transferId": "d2b9b9aa-3f24-4a63-b9de-9c3c9d5c9d7d",
  "messages": [
    {
      "role": "user",
      "content": "Résous x + 2 = 5",
      "createdAt": "2026-11-08T10:00:00.000Z"
    },
    {
      "role": "assistant",
      "content": "x = 3",
      "createdAt": "2026-11-08T10:00:02.000Z"
    }
  ]
}
```

The payload is the local transcript (0–20 messages), alternating `user` then `assistant`, with an optional final unanswered `user` message. The merged transcript must contain exactly two messages per successfully completed Guest turn (maximum 10 turns), plus at most one pending final user message. Each content is 1–20,000 characters; the total content budget is 400,000 characters. Timestamps must be ISO date strings, chronological, and fall within the Guest session lifetime. The backend validates the message count against the server-side successful-turn counter and merges the mobile transcript with the bounded server context. This recovers a completed assistant response if the network dropped before the mobile received the SSE `done` event. Older messages may be present only in the mobile's volatile transcript because the model context is intentionally bounded.

Success response:

```json
{
  "conversationId": "guest_<server-derived-sha256>",
  "imported": true,
  "idempotentReplay": false,
  "messageCount": 2
}
```

The conversation ID is derived by the backend from the authenticated user ID and the UUID v4 `transferId`; the client cannot choose the owner or persisted conversation ID. The transaction inserts one normal `conversation` row and its normal `message` rows. A repeated request with the same authenticated user and transfer ID returns the existing conversation and does not insert duplicates.

The backend locks the Guest session during validation/import. It revokes the Guest token only after the PostgreSQL transaction commits. Validation errors, network failures before a response, and Neon transaction failures do not revoke the session. Empty Guest sessions return `422 GUEST_CONVERSATION_EMPTY` and remain active.

### Mobile transfer lifecycle

1. Keep the Guest token and transcript in volatile memory. Do not put the Guest token in AsyncStorage, SecureStore, Keychain, cookies or backups.
2. For each completed Guest turn, append the `userMessage` and `message` objects returned by the non-streaming response or the SSE `done` event. Preserve their exact `role`, `content` and `createdAt` fields. Do not commit streamed `delta` fragments as complete messages; if `done` is lost, send the last local transcript and let the backend merge its retained completed response.
3. Generate one UUID v4 `transferId` when the user starts account creation/sign-in. Keep that same ID and transcript while retrying.
4. After Better Auth succeeds, call the import endpoint with the authenticated session credential and `X-Guest-Session-Token`.
5. On any network error or non-2xx response, retain the transcript and transfer ID in memory and retry; do not clear the Guest state.
6. On 2xx, replace the local Guest thread with the returned `conversationId`, refresh the authenticated conversation history, and clear the local Guest transcript/token. The backend has already revoked the Guest session.

The app must not request confirmation or show a transfer-choice screen. A process restart still loses the volatile Guest token by design; the app must start a new Guest session after a fresh process.
