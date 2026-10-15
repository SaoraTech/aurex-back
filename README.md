Aurex Backend

The central API powering Aurex across platforms.

Aurex Backend is the server-side foundation of Aurex, Saora's mathematics-focused conversational assistant. It provides a shared API for Aurex clients, including Web, Android, iOS, and Desktop applications.

Built with NestJS and TypeScript, it centralizes authentication, conversations, AI provider orchestration, subscription-based access, mathematical computation, voice services, web research, file storage, and application security.

«Project status: Deployed on Render and undergoing technical validation. Deployment does not imply that every feature or third-party integration has been validated end to end.»

Table of Contents

- "Overview" (#overview)
- "Core Capabilities" (#core-capabilities)
- "Architecture" (#architecture)
- "Technology Stack" (#technology-stack)
- "Third-Party Integrations" (#third-party-integrations)
- "API Documentation" (#api-documentation)
- "Local Development" (#local-development)
- "Environment Configuration" (#environment-configuration)
- "Database and Migrations" (#database-and-migrations)
- "Testing and Quality Assurance" (#testing-and-quality-assurance)
- "Security" (#security)
- "Deployment" (#deployment)
- "Known Limitations" (#known-limitations)
- "Project Documentation" (#project-documentation)

Overview

Aurex Backend provides a common server-side foundation for Aurex applications. Instead of implementing authentication, subscription rules, provider access, and conversation management separately in every client, the backend centralizes these responsibilities.

Its primary objectives are to:

- Provide a consistent API across supported clients.
- Manage authentication and user-owned data.
- Orchestrate AI providers according to server-side access rules.
- Support mathematics-related workflows and complementary services.
- Apply quotas, security controls, and usage tracking.
- Make the platform easier to maintain and extend.

Core Capabilities

AI Conversations

- Persistent conversations and messages.
- Configurable AI model selection.
- Server-side model authorization based on the effective subscription plan.
- Controlled provider fallback and configurable timeouts.
- Provider usage and response latency tracking.
- Centralized Aurex identity and behavioral instructions.

Authentication and Access Control

- Better Auth integration.
- Session-based authentication and Bearer authentication support for native clients.
- User-specific access controls for conversations and stored resources.
- Server-side subscription and plan resolution.

Mathematical Computation

- Wolfram|Alpha integration through the mathematics module.
- A dedicated computation endpoint.
- Separation between conversational AI responses and mathematical computation.

A successful conversational response must not be treated as proof of formal mathematical verification unless the relevant computation was actually performed.

Voice Services

- Text-to-speech through ElevenLabs.
- Speech-to-text through ElevenLabs.
- Optional speech recognition fallback through Groq.
- Configurable language, model, voice, and upload limits.
- Subscription-based usage limits.

Web Search and Research

- Web search through Tavily.
- Optional web search in chat.
- A separate research workflow for deeper searches.
- Source references and research result handling.
- Configurable request budgets, timeouts, and caching.

File Library and Storage

- Private Cloudflare R2 object storage.
- User-owned file metadata.
- File upload, listing, download URL generation, and deletion.
- File type verification using binary signatures.
- File-size and storage quotas.

Platform Operations

- Readiness and health endpoints.
- Structured JSON logging and request correlation.
- Prometheus-compatible metrics with token protection.
- Security controls through Arcjet.
- Audit events, versioned artifacts, and privacy request handling.

Important: The capabilities above describe the implementation documented in the repository. Their actual availability depends on configuration, database state, provider access, and successful integration testing.

Architecture

Aurex Backend follows a modular NestJS architecture.

Aurex Clients
Web · Android · iOS · Desktop
             |
             v
       Aurex Backend
        NestJS API
             |
   +---------+----------+
   |         |          |
 Auth     Chat / AI   Security
   |         |          |
   +---------+----------+
             |
   +---------+-------------------+
   |         |         |         |
 Database  Math      Audio    Research
   |         |         |         |
 Neon      Wolfram   ElevenLabs Tavily
 PostgreSQL Alpha     / Groq
             |
       Private Storage
       Cloudflare R2

This is a conceptual overview, not an exhaustive deployment diagram. Optional services require their respective configuration and credentials.

Technology Stack

Layer| Technology
Backend framework| NestJS 11
Language| TypeScript
Runtime| Node.js 22.21+
Database| PostgreSQL on Neon
ORM and migrations| Drizzle ORM / Drizzle Kit
Authentication| Better Auth
Validation| Zod, class-validator
API documentation| Swagger / OpenAPI
Security| Arcjet, Helmet, CORS policies
Observability| Structured logs, Prometheus metrics
Object storage| Cloudflare R2
AI and research services| Multiple external providers

Third-Party Integrations

The backend uses external services for selected capabilities.

Integration| Purpose| Validation status
Gemini, Groq, Kimi, Qwen, DeepSeek, Grok| AI generation| Real provider access must be tested
Wolfram|Alpha| Mathematical computation| Real provider access must be tested
ElevenLabs| Speech generation and transcription| Documented as implemented; real integration test pending
Cloudflare R2| Private file storage| Documented as implemented; real integration test pending
Tavily| Web search and research| Documented as implemented; real integration test pending
Arcjet| Application security| Documented as implemented; production policy validation required
Neon| PostgreSQL database| Verify connectivity and migrations in the target environment
Novu, Resend, payment providers| Notifications and payments| Not implemented as active integrations

The presence of an environment variable does not mean that a service is operational. A provider should only be marked as verified after successful tests using the real service and appropriate credentials.

API Documentation

The API uses the "/api/v1" prefix for versioned application endpoints.

When enabled, Swagger UI is available at:

http://localhost:3000/docs

The documentation endpoint is disabled in production by default unless explicitly configured otherwise.

Main Endpoint Groups

Endpoint| Purpose
"/api/v1/health"| Health check
"/api/v1/health/ready"| Readiness check
"/api/v1/identity"| Public Aurex identity and capability information
"/api/v1/ai/models"| Models permitted for the authenticated user
"/api/v1/chat/messages"| Chat message submission
"/api/v1/math/compute"| Mathematical computation
"/api/v1/audio/speech"| Text-to-speech
"/api/v1/audio/transcriptions"| Speech-to-text
"/api/v1/research/search"| Web search
"/api/v1/research/deep"| Deep research
"/api/v1/library/documents"| User file library
"/api/v1/metrics"| Protected Prometheus metrics

Authentication is handled through Better Auth routes under "/api/auth".

Consult the generated Swagger specification and the relevant controllers before relying on request payloads, response schemas, or authentication requirements.

Local Development

Prerequisites

- Node.js 22.21 or later.
- npm.
- A PostgreSQL database, preferably a Neon development database.
- API credentials for the external services you intend to test.

1. Clone the repository

git clone https://github.com/SaoraTech/aurex-back.git
cd aurex-back

2. Install dependencies

npm ci

3. Configure environment variables

Create a local environment file:

cp .env.example .env

Configure the database connection, authentication secret, trusted origins, and the credentials for the integrations you need.

Never commit a real ".env" file or production credentials.

4. Generate and review database migrations

npm run db:generate
npm run db:migrate

Review the generated SQL and apply migrations to a development database before testing against any shared or production database.

5. Start the development server

npm run start:dev

The default local API address is:

http://localhost:3000

Swagger UI is available at "/docs" when enabled.

Environment Configuration

The complete list of configuration options is maintained in ".env.example".

Important configuration groups include:

- Core: "NODE_ENV", "PORT", "LOG_LEVEL"
- Database and authentication: "DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"
- Network and CORS: "TRUSTED_ORIGINS", "CORS_ORIGIN", "TRUSTED_PROXIES"
- AI providers: provider API keys, model IDs, timeouts, fallback limits
- Voice: "ELEVENLABS_ENABLED", ElevenLabs credentials, speech configuration
- Storage: "R2_ENABLED" and private R2 credentials
- Research: "TAVILY_ENABLED" and "TAVILY_API_KEY"
- Security: "ARCJET_KEY", "ARCJET_MODE"
- Observability: "METRICS_TOKEN"
- Plans and quotas: "PLAN_LIMITS_JSON", "PLAN_PRICES_JSON"

Do not publish actual secret values in documentation, logs, issues, or client applications.

Database and Migrations

Drizzle ORM manages PostgreSQL access and schema migrations.

Available commands:

npm run db:generate
npm run db:check
npm run db:migrate

Recommended workflow:

1. Update the schema.
2. Generate the migration.
3. Review the SQL and any destructive operations.
4. Apply the migration to a development database.
5. Run relevant tests.
6. Back up and validate the target database before production changes.

Do not use schema-push shortcuts as a substitute for reviewed production migrations.

Testing and Quality Assurance

Available scripts include:

npm run build
npm run lint
npm test
npm run test:e2e

For a deployment candidate, validate:

- Dependency installation and TypeScript compilation.
- Unit and end-to-end tests using the real project toolchain.
- Database migrations against a test database.
- Authentication and user authorization.
- AI provider access, timeouts, quotas, and fallback behavior.
- Voice, research, and storage integrations using real service credentials.
- Health and readiness checks.
- Client integration and error handling.

Do not describe the backend as fully tested until these checks have been executed successfully in a reproducible environment.

Security

Security principles include:

- Resolve user identity and subscription privileges on the server.
- Never trust a client-provided plan, quota, payment state, or billing amount.
- Keep provider credentials on the server.
- Restrict cross-origin access to approved origins.
- Validate incoming payloads and reject unexpected fields.
- Verify resource ownership before reading, modifying, or deleting user data.
- Keep private object storage private.
- Redact credentials and sensitive information from logs.
- Review database migrations and maintain backups.

Uploaded files receive type and signature checks, but the documented implementation does not include antivirus or content scanning. Do not assume that valid file signatures guarantee safe file contents.

Deployment

Aurex Backend is configured as a Render web service.

- Repository: "SaoraTech/aurex-back" (https://github.com/SaoraTech/aurex-back)
- Live API: "aurex-back.onrender.com" (https://aurex-back.onrender.com)
- Render dashboard: "Manage the service" (https://dashboard.render.com/web/srv-db7kcpad0e5s73e6molg)

Configured build command:

npm ci --include=dev && npm run build

Configured start command:

npm run start

Configured readiness path:

/api/v1/health/ready

A successful deployment confirms that the deployment process completed. It does not replace functional, security, database, and provider integration tests.

Known Limitations

Before opening the product to customers, verify the following:

- Real provider authentication, model availability, quotas, and costs.
- Arcjet policies and trusted proxy configuration in the deployed environment.
- Cloudflare R2 bucket privacy, permissions, upload and download behavior.
- ElevenLabs and Groq speech requests and fallback behavior.
- Tavily search and research behavior, including source handling.
- Database migrations and schema consistency.
- Subscription periods, pricing, quotas, and payment workflows.
- Data retention, account deletion, and privacy request procedures.
- File scanning and lifecycle management.
- Build, unit tests, and end-to-end tests using the real dependencies.

Pricing and quota defaults are configurable and should not be treated as finalized commercial terms.

Payment processing and the Novu/Resend notification adapters are not active implementations in the current documented codebase.

Project Documentation

For implementation details, consult:

- ""docs/INTEGRATIONS.md"" (docs/INTEGRATIONS.md) — integration behavior, configuration, and limitations.
- ""docs/AUDIT.md"" (docs/AUDIT.md) — code audit findings and outstanding verification work.
- "".env.example"" (.env.example) — environment configuration reference.
- ""package.json"" (package.json) — scripts and dependencies.

License

Check the repository's license file before redistributing or reusing this project.
