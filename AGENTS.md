# Aurex backend notes

- Stack: NestJS + Drizzle + Neon PostgreSQL. Run: `npm run start:dev`, build `npm run build`, tests `npm test --runInBand`.
- Jest config ignores `.base/` to avoid duplicate package.json haste collisions.
- E2E config: `test/jest-e2e.json` (rootDir `..`).
- Drizzle: `drizzle/meta/_journal.json` includes migration `0002_add_promotional_plans`.
- Never run migrations against production Neon.