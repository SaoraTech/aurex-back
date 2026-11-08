# Aurex API V1

Base path: /api/v1. Better Auth routes are mounted under /api/auth/*.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | /health | Liveness | No |
| GET | /health/ready | PostgreSQL readiness | No |
| GET | /plans | Plan display | No |
| GET | /entitlements/me | Authenticated user's effective plan, subscription status and quotas | Yes |
| GET | /admin/dashboard | Admin dashboard totals and recent audit activity | Admin |
| GET | /admin/audit-events | Paginated admin audit history; supports action, actorUserId and targetType filters | Admin |

Admin audit history records publication creation, edits and publication actions with the authenticated administrator as actor. Audit metadata excludes publication text and credentials. Audit persistence errors are logged without rolling back an already completed publication action.
| GET | /admin/publications | Admin publication list | Admin |
| POST | /announcements | Create a publication (admin only) | Admin |
| PATCH | /announcements/:id | Update a draft or scheduled publication (admin only) | Admin |
| POST | /announcements/:id/publish | Publish immediately or execute a scheduled publication (admin only) | Admin |
| GET | /announcements | List published in-app announcements | Optional |
| POST | /announcements/:id/read | Mark an announcement as read | Yes |
| GET | /announcements/unread-count | Current user's unread announcement count | Yes |
| GET | /admin/billing/payments | Admin payment list | Admin |
| GET | /admin/billing/subscriptions | Admin subscription list | Admin |
| GET | /admin/settings | Safe integration configuration status (no secrets) | Admin |
| GET | /admin/notifications/deliveries | Notification dispatch history and status | Admin |
| GET | /admin/notifications/summary | Notification dispatch counts by category, channel and status | Admin |
| GET | /notifications/preferences | Current editorial and transactional channel preferences | Yes |
| PATCH | /notifications/preferences | Update editorial and transactional channel preferences | Yes |
| POST | /guest/sessions | Create an ephemeral guest session | No |
| DELETE | /guest/sessions/current | Revoke current guest session | Guest Bearer |
| POST | /guest/chat/messages | Guest chat (non-streaming) | Guest Bearer |
| POST | /guest/chat/messages/stream | Guest chat via SSE | Guest Bearer |
| GET/POST | /conversations | List/create persisted conversations | Yes |
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

## Guest Mode

Guest sessions use a separate in-memory context and never write guest messages or conversations to Neon. Tokens are volatile Bearer credentials, expire automatically and can be revoked. Defaults, lifecycle requirements, SSE event schema and horizontal-scaling constraints are documented in [GUEST_MODE.md](./GUEST_MODE.md).

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

Both routes require authentication and are protected by the tts / stt security policies. User-scoped routes first pass a coarse Arcjet IP gate before Better Auth session lookup, then enforce their route-specific policy after resolving the verified user. Azure credentials never leave the backend. There is no speech-provider fallback.

## Error contract

~~~json
{ "statusCode": 429, "error": "Too Many Requests", "code": "STT_QUOTA_EXCEEDED", "message": "Quota atteint.", "details": {}, "requestId": "..." }
~~~

Clients should use the stable code field rather than matching localized messages. Rate-limit responses may include Retry-After. Never send authoritative plan, price or provider configuration from the client.

## Scheduled publications

Announcements with `publicationMode: "SCHEDULED"` are persisted with a due time and delivery mode. To execute due publications, configure a Render Cron Job for this service with:

- Command: `npm run jobs:publish-announcements`
- Schedule: every minute (`* * * * *`)

The backend web service does not run an in-process timer. Until this external Cron Job is configured and enabled, scheduled records remain queued and are not automatically published. The same job also expires elapsed subscriptions, refreshes affected Novu audience memberships, and retries failed or interrupted editorial notification outbox records. Publication claims are conditional and notification retries use stable delivery IDs and a deterministic Novu transaction ID.

## Novu editorial workflow configuration

Novu subscribers are synchronized when the authenticated client requests its subscriber token or updates notification preferences. Each subscriber is attached to a global audience topic and a current-plan topic for each enabled editorial channel. Topic keys use `announcements:<audience>:<channel>`, for example `announcements:all:email` or `announcements:plus:push`. When a plan or channel preference changes, the backend adds the required memberships and removes disabled or stale memberships through Novu's documented topic-subscription endpoints.

The backend triggers `aurex-announcement` separately for each selected channel, targeting the exact audience-and-channel topic and sending `payload.channel` with a single channel. This enforces editorial Email/Push preferences through topic membership rather than undocumented subscriber/payload filter variables. The Novu workflow must branch on `payload.channel` and execute only the matching Email or Push step. Subscriber data also carries server-resolved plan and editorial/transactional preferences; transactional workflows must honor `subscriber.data.transactionalEmailEnabled` and `subscriber.data.transactionalPushEnabled`.

Workflow publication and Email/Push provider integrations remain Novu workspace configuration tasks; backend code does not fabricate those settings. A `notification_delivery.status = triggered` record means Novu accepted the workflow trigger, not that a device or mailbox confirmed delivery. Failed and interrupted dispatches are stored in a durable outbox and retried by the scheduled job up to five attempts.

### Billing provider selection

Existing clients that omit `provider` continue to use Jɛmɛnipay. Web/Desktop clients may explicitly send `provider: "dodo_payments"`. Dodo product IDs must be configured in the provider dashboard and mapped through the DODO_PRODUCT_* environment variables; the backend does not create products or invent their prices.

### Store purchase verification requirements

- RevenueCat webhook events are authenticated using the configured authorization header. If HMAC signing is enabled in RevenueCat, configure `REVENUECAT_WEBHOOK_SIGNING_SECRET`; the backend verifies the raw body and timestamp, then re-reads the subscriber's current entitlements from RevenueCat before updating access.
- Huawei clients must first call `POST /api/v1/billing/huawei-iap/developer-payload` with Aurex authentication and pass the returned signed `developerPayload` to AppGallery IAP. The backend validates that payload against `HUAWEI_IAP_PAYLOAD_SECRET`, verifies the Huawei purchase-data signature and purchase token, and only then associates the subscription with the Aurex account. Raw user IDs are accepted only outside production for local development compatibility.
- Dodo webhook signatures are verified against the raw request body and the webhook ID/timestamp headers. Provider event IDs are persisted in the idempotency ledger.


### Automatic Guest conversation import

| Method | Path | Purpose | Authentication |
|---|---|---|---|
| POST | /guest/sessions/current/import | Import the current Guest transcript into the authenticated user's normal conversation history | Better Auth session + X-Guest-Session-Token |

The request body contains a client-generated UUID v4 `transferId` and a `messages` array of up to 20 alternating `user`/`assistant` messages, optionally ending with one unanswered `user` message. Each item requires `content` (1–20,000 characters) and ISO `createdAt`. The merged transcript must equal twice the server-side successful Guest-turn counter (maximum 10 turns), optionally plus one pending final user message; total merged content is capped at 400,000 characters. The backend merges the mobile transcript with its bounded in-memory context to recover a completed answer if the network dropped before the client received `done`.

The Better Auth credential stays in `Authorization: Bearer <session-token>` (or the authenticated `Cookie` header). The raw Guest token is sent separately as `X-Guest-Session-Token: <guest-token>`. This endpoint is user-authenticated and uses the existing authenticated `chat` Arcjet policy.

Success: `{ "conversationId": "guest_<server-derived-id>", "imported": true, "idempotentReplay": false, "messageCount": 2 }`. Repeated requests with the same user and `transferId` return the same conversation with `idempotentReplay: true`. The backend persists one normal conversation and its messages in a single PostgreSQL transaction, then revokes the Guest token. It creates no Guest tables and requires no migration.

Stable business errors include `GUEST_SESSION_REQUIRED`, `GUEST_SESSION_INVALID`, `GUEST_SESSION_EXPIRED`, `GUEST_SESSION_REVOKED`, `GUEST_SESSION_IMPORTED`, `GUEST_CONVERSATION_EMPTY`, `GUEST_IMPORT_INVALID_PAYLOAD`, `GUEST_IMPORT_INVALID_MESSAGE`, `GUEST_IMPORT_INVALID_ORDER`, `GUEST_IMPORT_PAYLOAD_MISMATCH`, `GUEST_IMPORT_PAYLOAD_TOO_LARGE`, `GUEST_GENERATION_IN_PROGRESS`, `GUEST_IMPORT_IN_PROGRESS`, and `GUEST_TRANSFER_CONFLICT`. A persistence failure returns `503 GUEST_IMPORT_PERSISTENCE_FAILED`; the Guest session remains active for retry. See [GUEST_MODE.md](./GUEST_MODE.md) for the complete mobile lifecycle and request example.
