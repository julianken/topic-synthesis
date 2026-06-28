import { seedDenseLibraryCard } from './seed';

// Playwright global setup — runs ONCE before the suite. Seeds the deterministic DENSE library card for
// the e2e owner so the library visual baseline (the seeded card grid) is byte-stable run to run. The DB
// must be migrated (`docker compose up -d && npm run db:migrate`) — same precondition the harness already
// documents. Idempotent: the seed clears the owner's prior curricula then inserts the one known card.
export default async function globalSetup(): Promise<void> {
  await seedDenseLibraryCard();
}
