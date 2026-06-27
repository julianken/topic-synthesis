/**
 * The PRE-v11 schema/prompt hashes, captured as a committed fixture (TS-14 AC2).
 *
 * Why a fixture and not a recompute. `persistRun` derives the `workflow_version` as
 * `contentHash(snapshotsJson, contentHash(PROMPTS_VERSION, LESSON_BRIEF_SCHEMA_HASH))`
 * (`src/store/repo.ts`). TS-10/TS-11/TS-12 REPLACED the brief schema, the spec/code prompts,
 * and the prompt registry IN PLACE — so once they merged onto `main` there is no live "pre-v11
 * side" left in the tree to recompute the prior `workflow_version` from. The only honest way to
 * assert "the v11 emission's `workflow_version` differs from the pre-v11 one" is to SNAPSHOT the
 * two constants' real values from the pre-v11 commit and pin them here.
 *
 * These were captured by importing the two constants from commit `45a8073` (the last commit before
 * TS-10/11/12 landed — the commit this issue was authored against) and recording their exact values:
 *
 *   $ git worktree add --detach /tmp/prev11 45a8073
 *   $ tsx -e 'import {LESSON_BRIEF_SCHEMA_HASH} from "./src/domain/stages";
 *             import {PROMPTS_VERSION} from "./src/pipeline/prompts"; console.log(...)'
 *
 * The `LESSON_BRIEF_SCHEMA_HASH` is UNCHANGED across v11 (the `LessonBrief` contract itself did not
 * change — TS-10 added the NEW `LessonSpec`/`Section` types alongside it); the distinctness comes
 * entirely from `PROMPTS_VERSION` bumping (TS-11 registered `spec-v11` in the prompt set, and
 * TS-12/TS-13 rewrote the `code` + `critic` prompts). This is what makes the v11 emission a distinct
 * eval arm at PERSIST time without any hand-bumped version literal — exactly program decision 7.
 *
 * These are byte-for-byte snapshots, NOT a derivation: they are deliberately frozen here so the
 * distinctness test (`repo.test.ts`) compares the live (post-v11) `workflow_version` against the real
 * historical value, not against a re-derivation of today's bytes (which would be tautological). They
 * are NOT consumed by production code — only by the AC2 assertion.
 */
export const PRE_V11_LESSON_BRIEF_SCHEMA_HASH = '4fdfd7f765ef9132' as const;
export const PRE_V11_PROMPTS_VERSION = '746aaf7ad5e79dac' as const;
