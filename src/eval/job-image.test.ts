import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// job-image.test — source-level invariants for the Cloud Run Job image boot (issue #162). These pin the
// load-bearing facts the Dockerfile/Terraform must keep so a future edit can't silently regress them:
//  C1 — the per-generation run-job ENTRYPOINT boots COMPILED JS (`node dist/job/run-job.js`), not `tsx`.
//  C5 — tsx STAYS installed (full `npm ci`, never --omit=dev/--production) because the migrate Job
//       command-overrides the SAME image to run `tsx src/store/migrate.ts`; the TS source stays in the
//       image for it. (The migrate-override's runtime resolution is also proven live by `npm run
//       db:migrate` = `tsx src/store/migrate.ts`.)

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const DOCKERFILE = read('../../Dockerfile.job');
const TF = read('../../infra/cloud-run.tf');
const PKG = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> };

describe('Dockerfile.job — compiled run-job boot (issue #162 C1)', () => {
  it('the run-job ENTRYPOINT boots the COMPILED bundle via node, not tsx', () => {
    expect(DOCKERFILE).toContain('ENTRYPOINT ["node", "dist/job/run-job.js"]');
    expect(DOCKERFILE).not.toContain('ENTRYPOINT ["node_modules/.bin/tsx"');
  });

  it('there is a compile stage that runs the build:job bundle + copies its dist into the runner', () => {
    expect(DOCKERFILE).toContain('npm run build:job');
    expect(DOCKERFILE).toContain('/app/dist ./dist');
  });

  it('build:job is a real esbuild bundle emitting dist/job/run-job.js (anti-invention)', () => {
    expect(PKG.scripts['build:job']).toBeDefined();
    expect(PKG.scripts['build:job']).toContain('esbuild');
    expect(PKG.scripts['build:job']).toContain('--outfile=dist/job/run-job.js');
  });

  it('still runs as the non-root job user', () => {
    expect(DOCKERFILE).toContain('USER job');
  });
});

describe('Dockerfile.job — tsx stays for the migrate Job override (issue #162 C5)', () => {
  it('keeps the FULL install — the `npm ci` COMMAND carries no prune flag (tsx must survive for migrate)', () => {
    // Assert the actual install COMMAND line, not the whole file — the comments legitimately mention the
    // `--omit=dev` flag to explain why it's avoided.
    const ciLine = DOCKERFILE.split('\n').find((l) => l.trim().startsWith('RUN npm ci'));
    expect(ciLine, 'has a `RUN npm ci` install line').toBeDefined();
    expect(ciLine).not.toContain('--omit');
    expect(ciLine).not.toContain('--production');
  });

  it('keeps the TS source + tsconfig in the runner so `tsx src/store/migrate.ts` can still run', () => {
    expect(DOCKERFILE).toContain('COPY --chown=job:job package.json tsconfig.json ./');
    expect(DOCKERFILE).toContain('src ./src');
  });

  it('the migrate Job command-override still resolves to tsx + the migrate entry (infra/cloud-run.tf)', () => {
    expect(TF).toContain('command = ["node_modules/.bin/tsx"]');
    expect(TF).toContain('args    = ["src/store/migrate.ts"]');
  });
});
