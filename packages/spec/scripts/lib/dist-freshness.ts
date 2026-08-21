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
 *
 * ## Why the caller names ITSELF, and why that is not a third `mode` (#7181)
 *
 * #7181 adopted this in three more dist-reading gates and asked whether `mode`
 * wants a third value. Measured against the code, it does not: `mode` is read in
 * exactly two places, and only one of them is about semantics.
 *
 *   - the DAMAGE sentence — "writing a wrong baseline" vs "agreeing with one".
 *     Those are the only two things a dist reader does, and all four call sites
 *     land in one of them (`check:dual-source-exports --update` regenerates a
 *     tracked baseline and is `generate`-shaped; the rest are `check`-shaped).
 *   - the RE-RUN command, which used to be spelled `${gen|check}:api-surface` by
 *     hand. That is not a semantic difference at all — it is the caller's own
 *     name, and hardcoding it made three adopted gates print a fourth gate's.
 *
 * A third value would therefore have to mean "check-shaped, but print a different
 * command", i.e. text wearing a semantic label — and it would still be wrong for
 * the fifth caller. So the name is a REQUIRED argument instead: the compiler makes
 * every new caller state how to re-run itself, and there is no default to inherit
 * the wrong gate's identity from. `--update` above is the reason it is a full
 * command string rather than an npm script name — that path is not reachable
 * through one.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { bundlesAreStale, distIsStale } from '../../../../scripts/check-regen-pending.mjs';

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
function hasFileMatching(dir: string, pred: (name: string) => boolean, depth = 0): boolean {
  if (depth > 12 || !existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasFileMatching(child, pred, depth + 1)) return true;
    } else if (pred(entry.name)) return true;
  }
  return false;
}

function hasDeclarations(dir: string): boolean {
  return hasFileMatching(dir, (name) => name.endsWith('.d.ts'));
}

/**
 * The precondition, as data: may this run read `<pkgDir>/dist` and believe it?
 *
 * Returns the verdict rather than exiting so the rule and its wording can be
 * driven from a test in both directions — a guard only ever observed green is
 * indistinguishable from one that matches nothing (#4690).
 *
 * @param mode  what this run would do with the dist — see `DistReadMode`.
 * @param rerun the exact command that re-runs THIS caller after the build, e.g.
 *   `pnpm --filter @objectstack/spec check:exported-any`. Required on purpose:
 *   a default would hand a new caller the previous gate's identity, which is the
 *   defect #7181 was filed for (three gates printing `check:api-surface`).
 */
export function inspectDistFreshness(
  pkgDir: string,
  mode: DistReadMode,
  rerun: string,
): DistFreshness {
  if (!distIsStale(pkgDir)) return { fresh: true };

  const state: 'missing' | 'stale' = hasDeclarations(join(pkgDir, 'dist')) ? 'stale' : 'missing';

  const damage =
    mode === 'generate'
      ? `Regenerating now would WRITE a baseline describing a build that no longer matches src:\n` +
        `   every export added since that build reads as a REMOVAL, and this generator's own rule\n` +
        `   calls a removed export a BREAKING change. The wrong baseline is then self-consistent —\n` +
        `   the checking half compares it against the same stale dist and passes (#7122, #4687).`
      : `A verdict now would be computed against a build that no longer matches src, so this\n` +
        `   check would reach its conclusion without ever reading the declarations under test —\n` +
        `   a FALSE GREEN on exactly the change it exists to catch (#7122).`;

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
      `     ${rerun}\n\n` +
      `   (Do NOT use OS_SKIP_DTS=1 for this one — AGENTS.md §9 names it as the flag that emits JS\n` +
      `   and skips exactly the declarations this reads.)`,
  };
}

/**
 * The same precondition for the OTHER half of `dist` — the emitted JS bundles.
 *
 * ## Why this is a second axis and not a second copy
 *
 * `inspectDistFreshness` above measures `dist/**\/*.d.ts`. `dist/<entry>/index.mjs`
 * is a different artifact produced by a different pass, and the two can disagree
 * in BOTH directions (the rule's own docblock in
 * `scripts/check-regen-pending.mjs` has the measurement):
 *
 *   - `BUILD_DTS=true tsup` refreshes declarations and re-emits no bundle, so a
 *     `.d.ts`-fresh tree can hold bundles older than the edit under test;
 *   - `OS_SKIP_DTS=1` emits fresh bundles and skips declarations, so a
 *     `.d.ts`-stale tree can hold bundles that are exactly current.
 *
 * A bundle reader that asked the `.d.ts` question would therefore be capable of
 * believing a stale bundle (direction one) while refusing a current one
 * (direction two). So the axes are separate — but they live in ONE home, this
 * file, so the next bundle-reading gate finds them together rather than
 * inventing a third notion of "is packages/spec/dist current".
 *
 * ## Why the refusal, and not a skip
 *
 * #10199's gate asserts that a declared browser-reachable entry links no zod. On
 * an unbuilt or stale tree the honest answer is NOT MEASURED, and the two
 * failure shapes are the ones #4690 named: a missing `dist` makes "no zod link
 * found" and "no bundle read" the same green, and a stale `dist` makes the
 * verdict describe a build that predates the import someone just added — a false
 * green on precisely the change the gate exists to catch. Both are refusals.
 *
 * @param mode  what this run would do with the bundles — see `DistReadMode`.
 * @param rerun the exact command that re-runs THIS caller after the build.
 */
export function inspectBundleFreshness(
  pkgDir: string,
  mode: DistReadMode,
  rerun: string,
): DistFreshness {
  if (!bundlesAreStale(pkgDir)) return { fresh: true };

  const state: 'missing' | 'stale' = hasFileMatching(
    join(pkgDir, 'dist'),
    (name) => name.endsWith('.mjs') || name.endsWith('.js'),
  )
    ? 'stale'
    : 'missing';

  const damage =
    mode === 'generate'
      ? `Regenerating now would WRITE a ledger describing bundles that no longer match src.`
      : `A verdict now would be computed against bundles that no longer match src, so this\n` +
        `   check would reach its conclusion without ever reading the module graph under test —\n` +
        `   NOT MEASURED reported as if it were measured and clean (#4690).`;

  const cause =
    state === 'missing'
      ? `packages/spec/dist holds no .mjs/.js bundles — the package is not built. This gate reads\n` +
        `   the module a consumer's import actually loads, so there is nothing here to read.`
      : `packages/spec/dist's .mjs/.js bundles are OLDER than packages/spec/src (or than\n` +
        `   tsup.config.ts, which decides the entries, the externals and whether entries are\n` +
        `   self-contained). The bundles on disk predate the sources.`;

  return {
    fresh: false,
    state,
    message:
      `\n❌ ${cause}\n\n` +
      `   ${damage}\n\n` +
      `   Build first, then re-run:\n\n` +
      `     pnpm --filter @objectstack/spec build\n` +
      `     ${rerun}\n\n` +
      `   (OS_SKIP_DTS=1 is fine for THIS gate — it still emits every bundle this reads. It is\n` +
      `   the .d.ts-reading gates next door that it blinds.)`,
  };
}
