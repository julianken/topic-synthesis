import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_STATUSES } from './sitemap';

describe('page status single source of truth', () => {
  it('matches the Postgres CHECK constraint in schema.sql', () => {
    const schemaPath = fileURLToPath(new URL('../store/schema.sql', import.meta.url));
    const sql = readFileSync(schemaPath, 'utf8');
    const captured = sql.match(/status\s+IN\s*\(([^)]+)\)/i)?.[1];
    expect(captured, 'could not find the status CHECK constraint in schema.sql').toBeDefined();
    const sqlValues = captured!
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect([...sqlValues].sort()).toEqual([...PAGE_STATUSES].sort());
  });
});
