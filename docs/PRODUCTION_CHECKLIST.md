# Production readiness checklist

- [ ] Review and run `npm run build`, unit tests, e2e tests and dependency audit.
- [ ] Generate Drizzle migrations; inspect SQL; test forward migration and restore from backup.
- [ ] Configure production TLS, trusted origins, secure cookies, rate limits at edge, secrets manager and log redaction.
- [ ] Verify session revocation, account enumeration protection, email verification and password-reset flows.
- [ ] Resolve subscription source-of-truth and apply plan limits server-side (currently fail-safe Free limit).
- [ ] Complete idempotent request persistence and concurrency tests for chat.
- [ ] Validate AI provider limits, retries, timeout, cancellation, streaming and prompt-injection handling.
- [ ] Validate Wolfram errors, usage/cost controls and mathematical answer provenance.
- [ ] Approve payment provider; implement signed webhooks, idempotency, reconciliation, refunds and sandbox tests.
- [ ] Implement private R2 adapter, signed upload/download URLs, MIME sniffing, file-size limits and malware scanning.
- [ ] Implement Novu SDK adapter, retries, delivery status and user notification preferences.
- [ ] Implement deletion worker, object cleanup, retention policy and legal hold behavior.
- [ ] Add admin RBAC, admin audit trail, support impersonation safeguards (if ever needed).
- [ ] Add monitoring, error reporting, traces, alerting, backup/restore drill and load tests.
- [ ] Test clients: Web, Android/Kotlin, iOS/Swift, React Native/Expo, Electron/Windows/Linux/macOS.
