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
