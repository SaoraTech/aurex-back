# Aurex Backend Evolution — Audit and Implementation Plan

Audit baseline: `main` at `5bf0a7f668306c98c11f5865d0f79f9789bc54cb`.
Working branch: `feat/billing-communications-admin`.

## Confirmed current state

### Billing
- `BillingModule`, `BillingController`, and `BillingService` already exist.
- The current provider contract is Jɛmɛnipay-specific (`providerName: 'jemenipay'`, checkout response provider literal).
- `JemenipayProvider` is implemented and registered in `BillingModule`; the existing checkout and webhook routes are live code.
- Current database tables include `payment` and `subscription`; payment status enum includes pending, processing, succeeded, failed, cancelled, refunded.
- Existing subscription handling activates a new subscription after a successful Jɛmɛnipay webhook, but the current model does not provide a unified provider-event inbox or a complete cross-provider lifecycle.
- `PlansService` resolves effective plans and quotas already depend on it. No dedicated EntitlementsModule currently exists.
- `.env.example`, `EnvSchema`, and `env.factory.ts` currently contain Jɛmɛnipay variables. Do not remove or rename them.

### Communications
- `AnnouncementsModule` already supports drafts, review, publishing, audience targeting, and categories.
- Current publication modes are `manual | automatic | hybrid`; they do not match the required delivery modes.
- Announcements are persisted in PostgreSQL. There is no schedule timestamp, publication delivery ledger, or per-user read state in the current announcement model.
- `NotificationsModule` currently exposes the Novu subscriber HMAC and a workflow trigger helper.
- The Novu service reads `novuApiKey`, `novuApiUrl`, and `novuAppIdentifier`, but these settings are not currently declared in `EnvSchema` or mapped by `env.factory.ts`. The package manifest also has no Novu SDK dependency; the service currently uses the REST API.
- `notification_preference` exists with email/product toggles. It does not yet represent channel-specific editorial/transactional preferences or delivery history.

### Administration
- `RequireAdminGuard` already protects some announcement admin routes using the configured `ADMIN_EMAILS` allowlist.
- There is no dedicated Aurex Admin API module, persisted admin-role model, permission model, or admin dashboard API.
- Better Auth sessions and user identity are already available to guards.

### Persistence and migrations
- PostgreSQL schema is defined in `src/db/schema.ts`; migrations are managed by Drizzle in `drizzle/`.
- Existing migrations are additive. New schema work must use additive migrations and preserve existing rows.
- Raw request bytes are captured in `main.ts`, which is important for provider webhook signature verification.

## Implementation principles

1. Preserve Jɛmɛnipay adapter, service, webhook endpoint, environment variables and current checkout behavior.
2. Add providers behind a generic contract; do not mark a provider operational until its credentials, merchant-side configuration and live/sandbox verification are complete.
3. Centralize plan access decisions in EntitlementsModule while preserving PlansService compatibility for existing quota consumers.
4. Treat provider webhooks as untrusted, verify signatures/authentication, persist provider event IDs uniquely, and process transitions transactionally/idempotently.
5. Separate editorial notifications from transactional notifications; do not route payment/security events through editorial preferences.
6. Use Novu as the orchestration layer, but keep Aurex's own publication, audience, read-state and delivery-attempt records authoritative.
7. Implement scheduling with persisted `scheduledAt` and a worker/cron mechanism only after the repository's runtime constraints are verified. Never claim a scheduled publication is active if no scheduler is running.
8. Protect every admin route with authentication and server-side authorization. Keep the initial single-admin allowlist compatible, but design role/permission expansion without trusting client claims.
9. Add tests for state transitions, webhook replay, authorization, publication modes, audience targeting and delivery failures.
10. Do not add fake provider credentials, fabricated workflow IDs, or pretend provider account configuration.

## Phased implementation

### Phase A — Billing foundation
- Generalize provider contracts without changing Jɛmɛnipay's external behavior.
- Add provider registry and provider-specific webhook routes.
- Add RevenueCat, Dodo Payments and Huawei IAP adapters using documented server verification flows.
- Add provider event inbox/idempotency and normalized subscription lifecycle.
- Add EntitlementsModule and migrate existing plan reads through it without breaking PlansService consumers.
- Add additive DrizzIe schema/migrations and tests.

### Phase B — Product communications
- Evolve existing announcements and notifications rather than creating parallel modules.
- Add the required `IN_APP_ONLY`, `MULTI_CHANNEL`, and `SCHEDULED` modes.
- Add scheduling metadata, read/unread records, delivery attempts, channel preferences and delivery status.
- Correct Novu environment validation/mapping and subscriber provisioning/topic targeting.
- Keep transactional workflows separate from editorial communications.

### Phase C — Aurex Admin API
- Add a dedicated admin module/controller namespace for dashboard, publications, notifications, billing and settings.
- Reuse the existing auth/session and admin guard foundations.
- Add auditable admin permissions with a safe initial single-admin configuration.
- Add endpoint documentation and authorization tests.

### Phase D — Verification and handoff
- Run build, lint, unit tests and E2E tests.
- Review migration SQL for non-destructive behavior.
- Verify GitHub CI.
- Verify Render deployment separately; do not deploy automatically from this feature branch.
- Report code implementation separately from external provider configuration and end-to-end operational verification.
