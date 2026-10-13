# Architecture and client support

```text
Web ───────────────┐
Android / Kotlin ──┤
iOS / Swift ───────┤── HTTPS/JSON + optional SSE ── NestJS modular monolith
React Native/Expo ─┤                              ├─ Better Auth
Desktop/Electron ─┘                              ├─ PostgreSQL/Drizzle
                                                ├─ AI adapter (Gemini)
                                                ├─ math adapter (Wolfram|Alpha)
                                                ├─ billing provider interface (disabled)
                                                ├─ private storage adapter (not enabled)
                                                └─ notifications adapter (not enabled)
```

All business authorization is server-side. Clients never supply an authoritative plan, amount, provider status or role. API contracts are platform-agnostic. Native clients should use secure platform storage for refresh/session credentials. Electron must use context isolation, sandboxing, a strict Content Security Policy, no Node integration in renderer, and validated IPC; secrets remain server-side.

## Request path (V1 consolidated)
Express → `requestContext` (X-Request-Id, access log) → CORS/Helmet → `/api/auth/*`: `authProtection` (Arcjet) → Better Auth → raw/JSON body parsers (hard limits) → Nest: global `ProtectGuard` (session → Arcjet/local limits) → `RequireUserGuard` → validation pipe → controller → service → providers (timeouts, typed errors, metrics) → `AllExceptionsFilter`.
Modules added: `common` (errors, logger, redaction), `security` (Arcjet), `identity`, `providers` (registry), `observability` (metrics, usage), `audio`, `storage`, `research`; `library` now backed by R2.
