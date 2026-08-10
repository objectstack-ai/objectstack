// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dist-freshness.ts — the precondition `build-api-surface.ts` had written down
 * in prose and enforced nowhere (#7122).
 *
 * ## The failure this refuses
 *
 * `gen:api-surface` reads the BUILT `dist/*.d.ts`. Its docblock has always said
 * "run after `pnpm --filter @objectstack/spec build`", and nothing checked it.
 * On a stale dist the generator does not fail — it emits a plausible baseline
 * with every export added since the last build MISSING, and by that generator's
 * own rule a removed export is a BREAKING change:
 *
 *   1. stale dist  ⇒  `gen:api-surface` writes a baseline missing a live export;
 *   2. `check:api-surface` then compares that baseline against THE SAME stale
 *      dist and passes;
 *   3. the deletion rides into an unrelated PR where no reviewer reads
 *      `api-surface/contracts.json`, and the next honest regeneration re-adds
 *      the line — reading as an ADDITION rather than as a repair.
 *
 * Green at every step. #7122 measured it: a dist built from a base 24 commits
 * behind `origin/main` deleted `JobRunOutcome (interface)` from
 * `api-surface/contracts.json` while `JobRunOutcome` was a live export the whole
 * time. #4687 is the same trap landing unnoticed, caught only by diffing the
 * generated files against `main`. AGENTS.md §9 records the class.
 *
 * So the answer is a REFUSAL, in both modes, and a wrong baseline is worse than
 * no baseline. `--check` is included deliberately: a check that reports "surface
 * unchanged" against a build nobody made is a FALSE GREEN on exactly the export
 * change the gate exists to catch, and it is the step that lets CI agree with a
 * laundered removal.
 *
 * ## Why the guard lives in the GENERATOR and not in its callers
 *
 * It already lived in two callers and neither covers the path #7122 took:
 * `check:generated --fix` refuses `readsDist` generators on a stale dist, and
 * `scripts/check-regen-pending.mjs` refuses them at pre-commit. Running
 * `pnpm --filter @objectstack/spec gen:api-surface` (or `check:api-surface`)
 * directly — which is what the reporter did, what AGENTS.md tells you to do
 * after changing an export, and what lint.yml runs — reaches neither.
 *
 * `build-docs.ts` already made this exact move one artifact over (#4723): it
 * carries `schemaTreeIsStale` itself "so EVERY caller is covered rather than
 * this one". Same shape, same reason.
 *
 * ## Why the mtime rule and NOT `dist/.build-input-hash`
 *
 * #7122 suggested reusing the content stamp that `scripts/check-dev-prereqs.mjs`
 * writes. Measured, it is the wrong primitive FOR THIS CONSUMER, in the
 * dangerous direction:
 *
 *   - The stamp is written by `packages/spec`'s build unconditionally, INCLUDING
 *     under `OS_SKIP_DTS=1` — that build emits JS, leaves whatever `.d.ts` was
 *     there before, and stamps anyway. check-dev-prereqs.mjs lists this as a
 *     known FALSE GREEN and names this gate as the one it breaks; AGENTS.md
 *     §"Added or removed a `packages/spec` export?" says the same in the other
 *     direction ("skips exactly the artifact the gate inspects, and the check
 *     passes locally while failing in CI"). A stamp-based guard would therefore
 *     be green on the one local build flag that guarantees the declarations this
 *     generator reads are stale.
 *   - `distIsStale` keys on `dist/**` + `.d.ts` mtimes against `src/**` + `.ts`
 *     — the artifact this generator actually consumes — so it catches the
 *     `OS_SKIP_DTS=1` shape as well as #7122's rebase-behind-the-dist shape.
 *   - It is also the rule the other three consumers already read, so this adds
 *     no second notion of "is packages/spec/dist current"; a second copy drifts,
 *     and the direction it drifts in is the one that writes a confident wrong
 *     baseline (#4675).
 *
 * The stamp's own strength — content, not mtime (#5864) — is real and NOT
 * discarded: it still guards `pnpm dev`. It is simply blind to the half of the
 * dist that this generator is made of. Closing the `OS_SKIP_DTS` hole in the
 * stamp itself is a separate change to a separate script.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { distIsStale } from '../../../../scripts/check-regen-pending.mjs';

/** What the generator is about to do, so the refusal can name the real damage. */
export type DistReadMode = 'generate' | 'check';

export type DistFreshness =
  | { fresh: true }
  | { fresh: false; state: 'missing' | 'stale'; message: string };

/**
 * Does `dist` hold any declaration at all?
 *
 * Only ever used to pick the right SENTENCE — "missing" and "stale" are one
 * refusal with two causes and two different fixes to suggest. The freshness
 * verdict itself is never decided here; that stays in the one shared rule.
 *
 * A dist with JS and no `.d.ts` is the `OS_SKIP_DTS=1`-on-a-virgin-tree shape,
 * and it reads as missing rather than stale because that is what it is.
 */
function hasDeclarations(dir: string, depth = 0): boolean {
  if (depth > 12 || !existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasDeclarations(child, depth + 1)) return true;
    } else if (entry.name.endsWith('.d.ts')) return true;
  }
  return false;
}

/**
 * The precondition, as data: may this run read `<pkgDir>/dist` and believe it?
 *
 * Returns the verdict rather than exiting so the rule and its wording can be
 * driven from a test in both directions — a guard only ever observed green is
 * indistinguishable from one that matches nothing (#4690).
 */
export function inspectDistFreshness(pkgDir: string, mode: DistReadMode): DistFreshness {
  if (!distIsStale(pkgDir)) return { fresh: true };

  const state: 'missing' | 'stale' = hasDeclarations(join(pkgDir, 'dist')) ? 'stale' : 'missing';

  const damage =
    mode === 'generate'
      ? `Regenerating now would WRITE a baseline describing a build that no longer matches src:\n` +
        `   every export added since that build reads as a REMOVAL, and this generator's own rule\n` +
        `   calls a removed export a BREAKING change. The wrong baseline is then self-consistent —\n` +
        `   check:api-surface compares it against the same stale dist and passes (#7122, #4687).`
      : `A verdict now would be computed against a build that no longer matches src, so this\n` +
        `   check would report the public API "unchanged" without ever reading the exports under\n` +
        `   test — a FALSE GREEN on exactly the change it exists to catch (#7122).`;

  const cause =
    state === 'missing'
      ? `packages/spec/dist holds no .d.ts declarations — the package is not built (or was built\n` +
        `   with OS_SKIP_DTS=1, which emits JS and skips exactly the artifact this reads).`
      : `packages/spec/dist/**/*.d.ts is OLDER than packages/spec/src — the declarations on disk\n` +
        `   predate the sources. If you built with OS_SKIP_DTS=1, that build did not rebuild them.`;

  return {
    fresh: false,
    state,
    message:
      `\n❌ ${cause}\n\n` +
      `   ${damage}\n\n` +
      `   Build first, then re-run:\n\n` +
      `     pnpm --filter @objectstack/spec build\n` +
      `     pnpm --filter @objectstack/spec ${mode === 'generate' ? 'gen' : 'check'}:api-surface\n\n` +
      `   (Do NOT use OS_SKIP_DTS=1 for this one — AGENTS.md §9 names it as the flag that cannot\n` +
      `   serve gen:api-surface.)`,
  };
}
