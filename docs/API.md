# Aurex API V1 (initial routes)

Base path: `/api/v1`. Authentication routes: `/api/auth/*` (Better Auth).

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Liveness | No |
| GET | `/health/ready` | PostgreSQL readiness | No |
| GET | `/plans` | Configured plan display | No |
| GET/POST | `/conversations` | List/create conversations | Yes |
| GET | `/conversations/:id/messages` | Messages owned by user | Yes |
| DELETE | `/conversations/:id` | Delete owned conversation | Yes |
| POST | `/chat/messages` | Send a message | Yes |
| POST | `/math/compute` | Wolfram calculation | Yes |
| GET | `/memory` | List memory | Yes |
| POST | `/memory` | Create memory | Yes |
| PATCH/DELETE | `/memory/:id` | Update/delete memory | Yes |
| GET/POST | `/artifacts` | List/create versioned artifacts | Yes |
| GET/POST | `/artifacts/:id/versions` | List/append versions | Yes |
| GET | `/library/documents` | List document metadata | Yes |
| GET | `/billing/history` | Payment history | Yes |
| POST | `/billing/checkout` | Checkout (disabled until adapter approved) | Yes |
| GET | `/privacy/export` | Export user data JSON | Yes |
| POST | `/privacy/delete-account` | Register deletion request | Yes |

Send `Idempotency-Key` on checkout requests. Current payment route deliberately refuses checkout until a validated provider adapter exists.

For native clients, test Better Auth's Bearer plugin with actual Android and iOS networking code and store tokens in Android Keystore / iOS Keychain. Do not store long-lived tokens in plain preferences or local storage.
