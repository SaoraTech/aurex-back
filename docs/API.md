# Aurex API V1

Base path: /api/v1. Better Auth routes are mounted under /api/auth/*.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | /health | Liveness | No |
| GET | /health/ready | PostgreSQL readiness | No |
| GET | /plans | Plan display | No |
| GET | /entitlements/me | Authenticated user's effective plan, subscription status and quotas | Yes |
| GET | /admin/dashboard | Admin dashboard totals and recent audit activity | Admin |
| GET | /admin/publications | Admin publication list | Admin |
| GET | /admin/billing/payments | Admin payment list | Admin |
| GET | /admin/billing/subscriptions | Admin subscription list | Admin |
| GET | /admin/settings | Safe integration configuration status (no secrets) | Admin |
| GET | /admin/notifications/deliveries | Notification dispatch history and status | Admin |
| GET | /admin/notifications/summary | Notification dispatch counts by category, channel and status | Admin |
| GET | /notifications/preferences | Current editorial and transactional channel preferences | Yes |
| PATCH | /notifications/preferences | Update editorial and transactional channel preferences | Yes |
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

## Scheduled publications

Announcements with `publicationMode: "SCHEDULED"` are persisted with a due time and delivery mode. To execute due publications, configure a Render Cron Job for this service with:

- Command: `npm run jobs:publish-announcements`
- Schedule: every minute (`* * * * *`)

The backend web service does not run an in-process timer. Until this external Cron Job is configured and enabled, scheduled records remain queued and are not automatically published. The job is idempotent and can safely be retried.

## Novu editorial workflow configuration

Novu subscribers are synchronized when the authenticated client requests its subscriber token or updates notification preferences. Each subscriber is assigned to the `announcements:all` topic and receives a server-managed `subscriber.data.plan` value (`free`, `plus`, or `pro`). The topic subscription filters the existing `aurex-announcement` workflow by `payload.targetAudience`. The workflow must honor `payload.channels` and the subscriber's `editorialEmailEnabled` / `editorialPushEnabled` data before sending each external channel. Workflow publication and email/push integrations remain Novu workspace configuration tasks; backend code does not fabricate those settings.

### Billing provider selection

Existing clients that omit `provider` continue to use Jɛmɛnipay. Web/Desktop clients may explicitly send `provider: "dodo_payments"`. Dodo product IDs must be configured in the provider dashboard and mapped through the DODO_PRODUCT_* environment variables; the backend does not create products or invent their prices.

### Store purchase verification requirements

- RevenueCat webhook events are authenticated using the configured authorization header. If HMAC signing is enabled in RevenueCat, configure `REVENUECAT_WEBHOOK_SIGNING_SECRET`; the backend verifies the raw body and timestamp, then re-reads the subscriber's current entitlements from RevenueCat before updating access.
- Huawei subscription events are verified using the configured AppGallery IAP public key and the Huawei subscription purchase-token verification API. The client must send the Aurex user ID as `developerPayload` at purchase time; the backend trusts only the signed server-returned purchase data.
- Dodo webhook signatures are verified against the raw request body and the webhook ID/timestamp headers. Provider event IDs are persisted in the idempotency ledger.
