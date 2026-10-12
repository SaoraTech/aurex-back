# Billing integration gate

No provider is considered approved. Before enabling one, implement and test:
1. provider-specific checkout creation and redirect validation;
2. signature verification over the exact raw webhook bytes;
3. replay prevention and unique provider event IDs;
4. amount/currency/plan validation against the server-side order;
5. a monotonic payment state machine and idempotent subscription update transaction;
6. reconciliation, refund/chargeback handling, logs without secrets, sandbox and production tests.
Until then `PAYMENT_PROVIDER=disabled` and checkout intentionally returns HTTP 503.
