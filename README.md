Aurex Backend

The backend powering Aurex, Saora's mathematics-focused AI assistant.

""TypeScript" (https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)" (https://www.typescriptlang.org/)
""NestJS" (https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)" (https://nestjs.com/)
""PostgreSQL" (https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)" (https://www.postgresql.org/)
""Hugging Face" (https://img.shields.io/badge/Hugging%20Face-SaoraTech-FFD21E?logo=huggingface&logoColor=black)" (https://huggingface.co/SaoraTech)

Aurex Backend is the server-side foundation of Aurex, a Saora product designed to help students understand mathematics, solve problems, and develop stronger mathematical reasoning through conversational AI.

It provides the APIs and backend services needed to support Aurex clients across mobile, web, and desktop platforms.

«Project: Aurex Backend
Organization: SaoraTech
Status: Under active development
Production API: https://aurex-back.onrender.com»

---

Table of Contents

- "About Aurex" (#about-aurex)
- "Core Capabilities" (#core-capabilities)
- "Architecture" (#architecture)
- "Technology Stack" (#technology-stack)
- "AI and Third-Party Integrations" (#ai-and-third-party-integrations)
- "SaoraTech on Hugging Face" (#saoratech-on-hugging-face)
- "API Overview" (#api-overview)
- "Getting Started" (#getting-started)
- "Environment Configuration" (#environment-configuration)
- "Database and Migrations" (#database-and-migrations)
- "Testing" (#testing)
- "Security" (#security)
- "Deployment" (#deployment)
- "Project Documentation" (#project-documentation)
- "Roadmap and Future Integrations" (#roadmap-and-future-integrations)
- "Contributing" (#contributing)
- "License" (#license)

---

About Aurex

Aurex is a mathematics-focused conversational assistant developed within the Saora ecosystem.

Its purpose is not merely to provide answers. It aims to help learners understand mathematical concepts, follow explanations, explore different approaches, and improve their ability to reason independently.

Vision

Make high-quality mathematical assistance more accessible to learners, beginning with university students in West Africa and expanding to a broader audience.

Mission

Provide an intelligent, accessible, and reliable mathematical learning experience through conversational assistance and specialized mathematical tools.

Target users

- University and college students
- Students studying mathematics and related disciplines
- Independent learners
- Educators and other users who need mathematical assistance

Aurex Backend provides the server-side capabilities that support this experience.

Core Capabilities

The backend is designed to support the following areas, depending on the enabled configuration and available integrations.

1. Conversational AI

- AI-powered mathematical conversations
- Message and conversation management
- Multi-provider AI routing
- Model availability and selection
- Server-side plan and access checks

2. Mathematical computation

- Mathematical computation through an external symbolic mathematics service
- A dedicated mathematical API layer
- Support for integrating specialized mathematical services into conversational workflows

Important: Language models can explain and orchestrate mathematical workflows, but deterministic calculations should be delegated to suitable mathematical engines whenever possible.

3. Audio and voice

- Text-to-speech integration
- Speech-to-text and audio transcription
- Support for configured speech providers and fallback services

4. Search and research

- Web search integration
- Research-oriented workflows
- Support for retrieving external information where configured

5. User content and document management

- Document and library management
- Conversation-related content
- Versioned artifacts where implemented
- Privacy-related request handling

6. Operational monitoring

- Health and readiness endpoints
- Request identifiers and structured logging
- Metrics for monitoring backend behavior
- Error handling and service diagnostics

The exact availability of each capability depends on the current implementation, environment configuration, and status of its external providers.

Architecture

Aurex Backend is built around a modular server-side architecture.

Aurex Clients
(Mobile / Web / Desktop)
          |
          v
      Aurex Backend
     (NestJS / REST API)
          |
          +---- Authentication & Access Control
          |
          +---- Conversational AI & Model Routing
          |
          +---- Mathematical Services
          |
          +---- Audio & Speech
          |
          +---- Search & Research
          |
          +---- Library & Content Management
          |
          +---- Billing & Plans
          |
          +---- Monitoring & Security
          |
          v
 PostgreSQL / External Providers

Architectural principles

- Modularity: Keep application responsibilities separated into maintainable modules.
- Security: Enforce authentication, validation, and access control on the server.
- Provider abstraction: Avoid coupling application logic unnecessarily to a single AI provider.
- Reliability: Use health checks, structured logging, and tests to identify problems.
- Extensibility: Allow future Saora services to integrate without redesigning the entire backend.

This diagram describes the intended high-level architecture, not a guarantee that every component is fully implemented or operational in every environment.

Technology Stack

Component| Technology
Language| TypeScript
Backend framework| NestJS
Runtime| Node.js
Database| PostgreSQL
Database ORM| Drizzle ORM
Database hosting| Neon
Authentication| Better Auth
Deployment| Render
AI and specialized services| External provider integrations
Security| Arcjet integration
Media storage| Cloudflare R2 integration
Monitoring| Prometheus-compatible metrics

The exact package versions and scripts are defined in the repository's "package.json" and lockfile.

AI and Third-Party Integrations

Aurex Backend is designed to work with specialized external services rather than relying on a single provider for every capability.

Service| Intended role
Kimi| Conversational AI provider
Qwen| Conversational AI provider
DeepSeek| Conversational AI provider
Grok| Conversational AI provider
Gemini| Conversational AI provider
Groq| AI inference and configured speech-related workflows
ElevenLabs| Text-to-speech and speech-related capabilities
Whisper| Speech transcription
Tavily| Web search and research
Wolfram|Alpha| Mathematical computation and symbolic results
Cloudflare R2| Object and media storage
Arcjet| Application security
Neon| Managed PostgreSQL database
Render| Backend deployment and hosting

The provider list describes integrations planned or represented in the project architecture. It does not guarantee that every provider has valid credentials, is enabled in the current deployment, or has passed an end-to-end production test.

Provider configuration should be managed through environment variables. Never commit API keys, access tokens, database credentials, or other secrets to the repository.

SaoraTech on Hugging Face

SaoraTech maintains an official presence on Hugging Face, a platform used by the machine-learning community to discover and share models, datasets, and AI applications.

Official profile: "huggingface.co/SaoraTech" (https://huggingface.co/SaoraTech)

This space can serve as a public entry point for SaoraTech's AI and research activities, including future model experiments, datasets, and demonstrations when they are published.

Hugging Face is part of the broader AI research ecosystem around SaoraTech. Its inclusion here does not imply that Aurex currently runs on a Saora-owned model hosted on Hugging Face.

API Overview

The backend exposes versioned API routes under "/api/v1".

The following route families are intended to help developers navigate the API. Verify each route against the current controllers and deployment before relying on it in a client application.

Route| Purpose
"/api/v1/health"| Basic service health
"/api/v1/health/ready"| Readiness checks
"/api/v1/identity"| Identity-related operations
"/api/v1/ai/models"| Available AI models
"/api/v1/chat/messages"| Conversational messaging
"/api/v1/math/compute"| Mathematical computation
"/api/v1/audio/speech"| Speech generation
"/api/v1/audio/transcriptions"| Audio transcription
"/api/v1/research/search"| Search
"/api/v1/research/deep"| Research workflows
"/api/v1/library/documents"| Document and library operations
"/api/v1/metrics"| Operational metrics, where enabled

Request methods, authentication requirements, request bodies, response schemas, and error formats should be taken from the current implementation.

There is no public third-party developer API offering announced in this README. These endpoints primarily support Aurex's own clients and services.

Getting Started

Prerequisites

Install the following tools:

- Node.js version compatible with the repository
- npm
- Git
- A PostgreSQL database, such as a Neon project
- Credentials for whichever external services you intend to enable

1. Clone the repository

git clone https://github.com/SaoraTech/aurex-back.git
cd aurex-back

2. Install dependencies

npm ci

If the repository does not contain a compatible lockfile, use the package manager and installation procedure documented by the project instead.

3. Configure environment variables

Create a local environment file using the example supplied by the repository:

cp .env.example .env

If ".env.example" is not present in the current branch, consult the project's configuration documentation before creating the file manually.

Set the required database connection, authentication settings, security configuration, and provider credentials locally.

4. Prepare the database

Check the available database scripts in "package.json", then run the repository's documented schema-generation and migration commands.

For example, if these scripts are defined in the current version:

npm run db:generate
npm run db:migrate

Do not run production migrations against a database unless you have verified the target connection and reviewed the migration changes.

5. Start the development server

npm run start:dev

Use the configured local port and API prefix to access the service.

6. Build the application

npm run build

The build and development commands must match the scripts defined in the current "package.json".

Environment Configuration

Configuration is managed through environment variables.

Depending on the enabled modules, the application may require values for:

- Database connectivity
- Authentication and session management
- AI provider API keys
- Speech and transcription providers
- Search and mathematical computation providers
- Object storage
- Security services
- Logging and monitoring

Use ".env.example" and the current configuration files as the source of truth for exact variable names and required values.

Security requirements

- Do not commit ".env" files containing secrets.
- Do not expose private API keys in client applications.
- Use separate credentials for development and production.
- Rotate credentials if they are accidentally exposed.
- Configure production environment variables through the hosting provider's secure settings.

Database and Migrations

Aurex Backend uses PostgreSQL with Drizzle ORM.

The database layer supports the application's persistent data requirements, including the entities needed by enabled identity, conversation, and content-management features.

Before changing the schema:

1. Review the existing Drizzle schema files.
2. Generate or prepare the migration using the repository's documented workflow.
3. Review the generated SQL.
4. Test migrations against a development database.
5. Back up important production data before applying risky changes.

Exact commands and schema details should be verified against the current repository.

Testing

Automated tests help protect application behavior and detect regressions.

The repository has included unit and integration tests during development. The current test count and passing status can change as code evolves.

Run the scripts that exist in the current "package.json". Typical commands may include:

npm test
npm run test:e2e
npm run build
npm run lint

Not every command above is guaranteed to exist in every revision.

A successful unit test suite does not automatically prove that external providers, production credentials, database migrations, or deployed endpoints work end to end.

Before a release, validate:

- Build and type-check results
- Unit and integration tests
- Database connectivity and migrations
- Authentication and access controls
- Configured provider calls
- Health and readiness endpoints
- Error handling and security configuration

Security

Security is an important part of the Aurex backend.

The project includes or is designed to support:

- Server-side authentication and authorization
- Request validation
- Security controls through Arcjet where enabled
- Restricted access to private storage
- Structured logging and request identifiers
- Careful handling of sensitive information
- Server-side enforcement of subscription or plan restrictions

Security controls must be verified against the current code and production configuration. A dependency being installed does not by itself prove that it is correctly configured or protecting every relevant route.

Please report suspected security vulnerabilities privately to the project maintainers rather than publishing exploit details or credentials.

Deployment

The backend is deployed through Render.

- Live service: "aurex-back.onrender.com" (https://aurex-back.onrender.com)
- Render dashboard: "Open service dashboard" (https://dashboard.render.com/web/srv-db7kcpad0e5s73e6molg)
- Source repository: "SaoraTech/aurex-back" (https://github.com/SaoraTech/aurex-back)

Production deployment requires correct environment variables, database access, and configuration for the external providers that are enabled.

After deploying a change:

1. Inspect the deployment logs.
2. Confirm that the deployment finishes successfully.
3. Check the health and readiness endpoints.
4. Verify database connectivity.
5. Test the relevant API routes.
6. Validate any affected external integrations.

A successful deployment or HTTP 200 health response confirms only the checks covered by that response. It does not prove that all product features are functioning correctly.

Project Documentation

For implementation details, consult the documentation maintained in the repository.

Useful documentation areas may include:

- Architecture and module boundaries
- API contracts and examples
- Environment configuration
- Database schemas and migrations
- Testing procedures
- Security and deployment notes
- Provider integration guides

Documentation should be updated alongside code changes so that developers can distinguish implemented features from planned work.

Roadmap and Future Integrations

Aurex is part of the broader Saora ecosystem. Its backend may evolve as Saora develops additional infrastructure and mathematical capabilities.

Potential future integration areas include:

- Alpha: Saora's AI and research subsidiary, intended to develop future AI models and intelligence technologies.
- SMP — Saora Mathematics Platform: A specialized platform for mathematical computation, verification, and generation.
- SVP — Saora Vision Platform: A platform for visual understanding.
- SMV — Saora Mathematics Vision: A mathematical-vision layer designed to process visual mathematical content through the combination of vision and mathematical capabilities.
- Saora Cloud: Saora's planned sovereign cloud platform for developers, businesses, and organizations.

These are future-facing ecosystem directions, not claims that those services are already available or integrated into the current deployment. Any integration should be added when the relevant service exists and its contract, security, and operational requirements are defined.

Contributing

Aurex Backend is part of SaoraTech's ongoing engineering work.

Before proposing or implementing a change:

1. Understand the relevant module and its existing interfaces.
2. Follow the repository's conventions.
3. Avoid committing secrets or personal data.
4. Add or update tests when changing behavior.
5. Update documentation when API contracts or configuration change.
6. Verify the build and relevant tests before merging.

For major architectural changes, document the motivation, alternatives, and potential impact before implementation.

License

Please consult the repository's "LICENSE" file for the applicable terms.

If no license file is present, the project should not be assumed to be open source or available for unrestricted reuse.
