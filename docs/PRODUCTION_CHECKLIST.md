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

## Added by the consolidation (must be done before production)
- [ ] `npm install && npm run build && npm test` in an environment with network access (not run during the audit).
- [ ] `npm run db:generate`, review SQL (see docs/AUDIT.md §7: unique idempotency index, `provider_usage`, library columns), test on a copy, then `db:migrate`.
- [ ] Set `ARCJET_KEY`; confirm `TRUSTED_PROXIES`; run one live request per category and confirm decisions in the Arcjet dashboard.
- [ ] Check the Arcjet bot allow-list with the real Android client (OkHttp) on `/api/auth/*`.
- [ ] Verify Better Auth sign-in/sign-up/session end-to-end after the `app.all('/api/auth/*splat')` change.
- [ ] Create the R2 bucket as **private**, scoped API token (object read/write on that bucket only), optional lifecycle rule; test upload → presigned download → delete.
- [ ] Choose `ELEVENLABS_TTS_VOICE_ID` for French; test TTS/STT with real audio; decide on Groq TTS fallback.
- [ ] Real Tavily search + deep research test; confirm quotas/costs.
- [ ] Add malware scanning before processing user files automatically.
- [ ] Write tests for `LibraryService`, `ChatService`, guards and an e2e suite (not covered here).
- [ ] Rotate any key that was ever pasted in a chat or committed.
