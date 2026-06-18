import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from './db';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  await getPool().query(sql);
  console.log('Schema applied.');
  await closePool();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
