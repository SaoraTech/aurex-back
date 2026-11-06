# Billing module boundary

Billing and speech are separate backend capabilities. The Azure AI Speech migration does not modify checkout, payment-provider adapters, webhook verification, subscription renewal, cancellation, refunds or plan transitions.

The audio module consumes the effective plan from PlansService and enforces feature usage through QuotasService. It must never trust a plan or quota supplied by the client.

When changing billing behavior, preserve:
1. provider-specific checkout creation and redirect validation;
2. signature verification over exact raw webhook bytes;
3. replay prevention and unique provider event IDs;
4. amount, currency and plan validation against the server-side order;
5. monotonic payment state transitions and idempotent subscription updates;
6. reconciliation, refunds, chargebacks and safe audit logging.

Do not infer payment-provider readiness from the presence of environment variables. Confirm the active adapter and its live webhook behavior independently.
