#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-input-hash -- the ONE definition of "which sources was this dist built
 * from", and the two stamps that record the answer.
 *
 * ## Why this is a module and not part of `check-dev-prereqs.mjs`
 *
 * It was part of that file, and for one consumer that was right: the digest is
 * written by `--stamp` at the end of a build and read by the gate at `pnpm dev`,
 * and "they must be the same function or the comparison means nothing" is why
 * the stamper lived beside its reader rather than in a script of its own.
 *
 * A SECOND consumer arrived with #14985 — `distIsStale` in
 * `scripts/check-regen-pending.mjs` — and the same sentence now argues for a
 * module: three call sites over one function, none of them a copy. Two things
 * made the alternative (importing the gate) actively wrong rather than merely
 * inelegant:
 *
 *   - `check-dev-prereqs.mjs` is a GATE FILE (lint.yml runs its `--self-test`),
 *     and `scripts/pm/dispatch-gates.mjs` refuses to follow a gate file for
 *     inherited watch hints. Importing it from a gate that IS followed silently
 *     subtracts the `packages/spec` hint that import would otherwise have
 *     carried — measured, and refused by that tool's own self-test.
 *   - it would have run a workspace scan and `process.exit`ed inside its
 *     importer, whose callers include the pre-commit hook.
 *
 * This module has no CLI, declares no path population and spells no watch hint
 * of its own: every path it touches arrives as an argument, so following it
 * subtracts nothing from anybody.
 *
 * ## The two stamps, and why there are two
 *
 * Both hold the SAME digest over the SAME inputs. The difference is which build
 * writes them, and that difference is the whole reason the second one exists —
 * see each constant's docblock, and the two `inspect*Stamp` readers at the
 * bottom for what each stamp may and may not be believed about.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Where a build records the hash of the inputs it was built from.
 *
 * Written by `--stamp` at the end of EVERY build of an amplifier package,
 * `OS_SKIP_DTS=1` included. Two consumers read it, and the difference between
 * what they may conclude is the whole reason the sibling stamp below exists:
 *
 *   - `check-dev-prereqs.mjs`'s boot gate, for which "this dist was built from
 *     these sources" is the whole question (#5864);
 *   - `bundlesAreStale` in scripts/check-regen-pending.mjs, for which it is
 *     evidence about the emitted `.mjs`/`.js` ONLY — see `inspectBuildStamp`.
 *
 * ⛔ It says NOTHING about `dist/**\/*.d.ts`: the flag it is written under can
 * skip the declaration pass entirely. That is #7122's rejected direction and it
 * stays rejected; DTS_STAMP_BASENAME is the file that answers for those.
 */
export const STAMP_BASENAME = '.build-input-hash';

/**
 * Where a build records that its DECLARATION pass ran, and over which inputs.
 *
 * Same digest, same writer, same directory as STAMP_BASENAME. The only
 * difference is WHEN it is written — and that difference is the whole point:
 * `--stamp` skips this file under `OS_SKIP_DTS=1`, the build flag that emits JS
 * and leaves whatever `.d.ts` was there before. So this stamp asserts something
 * STAMP_BASENAME cannot: *the declarations on disk were emitted from inputs with
 * this digest*.
 *
 * Written because a second consumer needs that fact and only that fact.
 * `distIsStale` in scripts/check-regen-pending.mjs answers "may a gate read
 * `<pkg>/dist/**\/*.d.ts` and believe it" from mtimes, which is conservative in
 * the right direction but fires on any rewrite that leaves the bytes alone — a
 * `git merge` or `git checkout` that re-checks-out an UNCHANGED source bumps its
 * mtime, and the build then legitimately does not run (turbo's cache hashes
 * content, so it is a cache hit that rewrites nothing), leaving the gate
 * refusing a dist that is in fact exactly current. `declarationStampState`
 * below is the evidence that clears that one case, and only that one case.
 *
 * ⛔ It is NOT a replacement for the mtime rule and must never become one: the
 * digest cannot see a hand-edited dist, a toolchain change or dependency drift,
 * which is why it may only ever ACQUIT a tree the mtime rule has already
 * accused, never accuse one the mtime rule cleared.
 */
export const DTS_STAMP_BASENAME = '.build-input-hash-dts';

/** Per-package build configuration that changes the output without being under src/. */
export const PACKAGE_BUILD_CONFIG = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsup.config.ts', 'tsdown.config.ts'];

/** Thrown for conditions that must fail the gate rather than shrink its coverage. */
export class CoverageError extends Error {}

export const rel = (root, p) => path.relative(root, p) || '.';
export const posixRel = (root, p) => rel(root, p).split(path.sep).join('/');

/**
 * Global build inputs, read from turbo.json's own `globalDependencies` rather
 * than restated here: the build's declaration of what invalidates every package
 * is the freshness definition's too, and a new entry there is covered without
 * anyone remembering this file. Only literal paths are understood — a glob would
 * silently hash fewer inputs, so it throws.
 */
export function globalBuildInputs(root) {
  const file = path.join(root, 'turbo.json');
  if (!existsSync(file)) throw new CoverageError(`turbo.json is missing — cannot determine the build's global inputs, so freshness cannot be judged.`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new CoverageError(`turbo.json is not readable as JSON (${err.message}) — cannot determine the build's global inputs.`);
  }
  const declared = cfg.globalDependencies ?? [];
  if (!Array.isArray(declared)) throw new CoverageError(`turbo.json 'globalDependencies' is not an array — cannot determine the build's global inputs.`);
  return declared.map((entry) => {
    if (typeof entry !== 'string' || entry.includes('*') || entry.startsWith('$')) {
      throw new CoverageError(
        `turbo.json globalDependencies entry ${JSON.stringify(entry)} is not a shape this gate can hash.\n` +
          `  Teach scripts/check-dev-prereqs.mjs the new shape — hashing fewer inputs than the build\n` +
          `  reads would make the freshness verdict pass vacuously.`,
      );
    }
    return path.join(root, entry);
  });
}

/** Every file under `dir`, sorted, node_modules excluded. */
export function filesUnder(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/**
 * sha256 over a package's build inputs — the freshness definition, in one place,
 * used by BOTH `--stamp` (at build time) and the gate (at boot time). They must
 * be the same function or the comparison means nothing, which is why the stamper
 * lives in this file rather than in a script of its own.
 *
 * Framing is length-prefixed (`<path>:<bytes>` then the bytes), so no separator
 * can be forged by a file's contents and no control character is needed to
 * delimit records.
 */
export function buildInputHash(root, pkgDir) {
  const src = path.join(pkgDir, 'src');
  if (!existsSync(src)) {
    throw new CoverageError(`${posixRel(root, pkgDir)}/src does not exist, so there is nothing to hash — this gate cannot vouch for its dist.`);
  }
  const inputs = [...filesUnder(src)];
  for (const name of PACKAGE_BUILD_CONFIG) inputs.push(path.join(pkgDir, name));
  inputs.push(...globalBuildInputs(root));

  const seen = new Set();
  const records = [];
  for (const file of inputs) {
    const key = posixRel(root, file);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push([key, file]);
  }
  records.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const hash = createHash('sha256');
  for (const [key, file] of records) {
    // An ABSENT input is hashed as absent rather than skipped: creating a
    // tsconfig where there was none changes how the package builds, so it has
    // to change the hash.
    if (!existsSync(file)) {
      hash.update(`${key}:absent\n`);
      continue;
    }
    const bytes = readFileSync(file);
    hash.update(`${key}:${bytes.length}\n`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/**
 * Read ONE of the two stamps and say what it vouches for. Shared by both
 * readers below, because "the stamp and the reader must compute the same
 * digest" is exactly as load-bearing between the two stamps as it is between a
 * stamp and its reader: two copies of this comparison would drift, and the
 * direction drift takes is the one that acquits.
 *
 * Three verdicts, and the asymmetry between them is deliberate:
 *
 *   - `match`     the recorded digest equals the inputs on disk right now, so
 *                 the artifact this stamp speaks for was emitted from exactly
 *                 these sources. This is the ONLY verdict that may clear an
 *                 mtime accusation.
 *   - `mismatch`  a build that writes this stamp ran, and the sources have
 *                 moved since. Nameable in a refusal message: this is not an
 *                 mtime artefact, the content really did change.
 *   - `unstamped` NO EVIDENCE — no stamp, an unreadable one, a digest that
 *                 cannot be computed, or a package whose build does not stamp
 *                 at all. Every one of those collapses to the same answer on
 *                 purpose: "cannot vouch" must never read as "vouched for"
 *                 (#4690), and absence of the input is not licence to acquit.
 *
 * It never throws: it is called from inside freshness predicates whose failure
 * direction is a silently wrong artifact, so an unreadable tree has to degrade
 * to `unstamped` rather than take the caller down.
 *
 * Both digests come back with the verdict so a refusal can SHOW its evidence
 * instead of asserting it — the defect #14985 filed was half a wrong message,
 * and "recorded X, sources now hash to Y" is a claim the reader can recompute.
 * `actual` is computed only when there is a valid digest to compare it against,
 * so the ~30ms hash stays off the path where no amplifier stamp exists at all.
 */
function inspectStamp(root, pkgDir, basename) {
  const none = { state: 'unstamped', recorded: null, actual: null };
  const stampFile = path.join(pkgDir, 'dist', basename);
  let recorded;
  try {
    if (!existsSync(stampFile)) return none;
    recorded = readFileSync(stampFile, 'utf-8').trim();
  } catch {
    return none;
  }
  if (!/^[0-9a-f]{64}$/.test(recorded)) return none;
  let actual;
  try {
    actual = buildInputHash(root, pkgDir);
  } catch {
    return { ...none, recorded };
  }
  return { state: recorded === actual ? 'match' : 'mismatch', recorded, actual };
}

/**
 * Did a DECLARATION-emitting build produce THIS dist from THESE sources?
 *
 * The reader for DTS_STAMP_BASENAME, exported because the caller that needs it
 * is `distIsStale` in scripts/check-regen-pending.mjs — and it has to be THIS
 * function over THIS hash, or the comparison means nothing (the same argument
 * that keeps `--stamp` in this file rather than in a script of its own).
 */
export function inspectDeclarationStamp(root, pkgDir) {
  return inspectStamp(root, pkgDir, DTS_STAMP_BASENAME);
}

/**
 * Did a BUNDLE-emitting build produce THIS dist from THESE sources?
 *
 * The reader for STAMP_BASENAME, exported for `bundlesAreStale` in
 * scripts/check-regen-pending.mjs, which measures `dist/**\/*.mjs` and `*.js`
 * — a different artifact from the declarations, produced by a different pass.
 *
 * ## Why reading STAMP_BASENAME is sound HERE and stays rejected next door
 *
 * #7122 proposed answering the DECLARATION rule with this stamp, and that was
 * measured wrong in the dangerous direction: `--stamp` writes this file under
 * `OS_SKIP_DTS=1`, the one build flag that emits JS and leaves whatever `.d.ts`
 * was there before — so it says fresh over stale declarations. That rejection
 * is pinned (`packages/spec/scripts/dist-freshness.test.ts`) and unchanged.
 *
 * On the BUNDLE axis the same fact points the other way. `OS_SKIP_DTS=1` emits
 * every bundle this stamp would then vouch for, so the case that ruled the file
 * out for declarations is not a hole here at all — it is the ordinary case.
 * What makes the vouching sound is the build script's ORDER, not the flag:
 * `packages/spec`'s `build` runs the unconditional `tsup` (the JS pass) before
 * `--stamp` in the same `&&` chain, so this file is never written by a run that
 * did not emit bundles. The declaration pass that follows is the one that can be
 * skipped, and skipping it cannot refresh this stamp because the stamp is
 * written after both either way.
 *
 * The same one-way property still governs: it may only ever ACQUIT a tree the
 * mtime rule has already accused, never accuse one it cleared. The digest still
 * cannot see a hand-edited dist, a toolchain change or dependency drift — the
 * mtime rule remains the only thing that convicts.
 */
export function inspectBuildStamp(root, pkgDir) {
  return inspectStamp(root, pkgDir, STAMP_BASENAME);
}
