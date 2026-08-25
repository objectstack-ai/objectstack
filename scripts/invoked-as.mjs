#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * invoked-as -- the ONE answer to "was this module run, or imported?"
 *
 *   node scripts/invoked-as.mjs --self-test
 *
 * Every CLI script in `scripts/` has to separate "node ran me" from "something
 * imported me" before it decides whether to do anything. Each one used to
 * answer that with its own hand-typed comparison of `process.argv[1]` against
 * `import.meta.url`, and the copies had drifted into ELEVEN distinct spellings
 * across 33 files -- measured, not estimated. Nine of the eleven were wrong,
 * and wrong in a direction nothing in CI can see.
 *
 * ## The bug every hand-typed spelling had
 *
 * **Node resolves symlinks for the module graph but leaves `process.argv[1]`
 * as the caller typed it.** Reach a script through a symlink and the two name
 * different paths, the guard answers `false`, and the script does NOTHING --
 * with exit 0 and no output.
 *
 * That is the silent-success direction this tree treats as worse than no check
 * at all. The CI wrappers spawn these tools and hold `result.status` only, so
 * an inert child is a GREEN gate. Measured on the tree that motivated this
 * module:
 *
 *   scripts/pm/check-governed-merges.mjs --test AGENTS.md
 *     direct  : exit=3, "GOVERNED -- no seat arms auto-merge"
 *     symlink : exit=0, no output
 *
 * and `EXIT_TEST_NOT_GOVERNED` is 0. So through a symlink the register's
 * "this PR is GOVERNED, a human merge is the review record" answer and its
 * "NOT governed, ordinary queue landing applies" answer are the SAME EXIT CODE.
 * A seat reading the status rather than the printed verdict gets a clearance
 * to arm auto-merge from a tool that never ran, on the one surface where human
 * merge IS the review record (Prime Directive #14).
 *
 * ## The two other directions the copies failed in
 *
 * **Basename matching** -- `import.meta.url.endsWith(argv[1].split('/').pop())`
 * and `argv[1].endsWith('qa-rollup.mjs')`. These survive a symlink that keeps
 * the basename, so they look fine, but they answer TRUE for ANY entry script
 * sharing the basename: they fire on IMPORT. The failure is the opposite
 * direction -- a module that runs its whole CLI inside someone else's process.
 *
 * **Percent-encoding** -- `new URL(import.meta.url).pathname === argv[1]`
 * compares an ENCODED pathname against a raw argv, and
 * ``new URL(`file://${argv[1]}`)`` bypasses the encoder `pathToFileURL`
 * applies. Both go inert on any checkout path containing a character that
 * needs encoding, with no symlink involved at all. Measured: a `#` in any
 * parent directory name is enough.
 *
 * ## The shape that survives
 *
 * Two comparisons. The plain `resolve` equality is the fast path and answers
 * the ordinary case. The `realpath` comparison is the half that keeps a
 * checkout REACHED THROUGH A SYMLINK from reading as "imported". It falls back
 * to `false` rather than throwing -- an entry path that cannot be read is not
 * this module.
 *
 * Comparing resolved PATHS (never URL strings) is what keeps percent-encoding
 * out of the answer entirely: there is no encoder to disagree about.
 *
 * ## Why callers should reach for `isEntrypoint`, not `invokedAs`
 *
 * `isEntrypoint(import.meta.url)` takes ONE argument and reads `process.argv`
 * itself, so a call site has nothing left to spell wrongly -- no `argv[1]`, no
 * `fileURLToPath`, no comparison. `invokedAs` is the testable core underneath
 * it, exported so the predicate is pinned by cases rather than trusted by
 * reading.
 *
 * `scripts/check-entry-guard.mjs` enforces this: a `process.argv[1]` in an
 * entry-guard position anywhere in `scripts/**` that is not this module is a
 * failure. That gate is what stops a TWELFTH spelling, which is the whole
 * reason this file exists rather than a one-time sweep.
 *
 * ## The siblings, and why the duplication is deliberate
 *
 * `packages/cli/src/utils/invocation.ts` exports `isProcessEntry`, the same
 * predicate for the same reason (its header cites this defect). It is NOT
 * imported here and this is not imported there: `scripts/` runs as plain .mjs
 * against a possibly-unbuilt tree, and making the whole tooling layer depend on
 * a package build to answer "was I run?" trades this bug for a worse one.
 *
 * A third copy lives outside this repo: objectui's `scripts/invoked-as.mjs`
 * carries the same predicate under the same name (ported from here, #5984), so
 * the pairing is a CROSS-REPO obligation as well as a local one.
 *
 * The duplication is therefore structural, but DIVERGENCE is not allowed --
 * two predicates answering this question differently is precisely the defect
 * being closed. All three copies carry the same two legs: realpath for
 * symlinks, and directory resolution for `node <dir>`. Change one, change the
 * others.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Is `entryArg` -- a `process.argv[1]` -- the module at `selfPath`?
 *
 * @param {string | undefined} entryArg  `process.argv[1]`, as node left it.
 * @param {string} selfPath  An absolute filesystem path to the module asking.
 * @returns {boolean}
 */
export function invokedAs(entryArg, selfPath) {
  if (!entryArg) return false;
  const self = resolve(selfPath);
  const entry = resolve(entryArg);

  // `node <dir>` gives the ENTRY ARGUMENT, and only it, directory resolution:
  // `argv[1]` can name the directory whose index this module is. Latent in
  // `scripts/` today (nothing here is an `index`), carried because the sibling
  // predicate in `packages/cli` carries it, and two predicates that answer this
  // question differently is the defect this module exists to close.
  const candidates = [entry, join(entry, 'index.mjs'), join(entry, 'index.js')];
  if (candidates.includes(self)) return true;

  const realSelf = realOrSelf(self);
  return candidates.some((c) => realOrSelf(c) === realSelf);
}

/** The realpath of `p`, or `p` itself when it cannot be read. */
function realOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Was the module identified by `importMetaUrl` run by node, rather than
 * imported? The form every `scripts/**` entry guard should use:
 *
 *   if (isEntrypoint(import.meta.url)) { ... }
 *
 * @param {string} importMetaUrl  The caller's own `import.meta.url`.
 * @returns {boolean}
 */
export function isEntrypoint(importMetaUrl) {
  return invokedAs(process.argv[1], fileURLToPath(importMetaUrl));
}

// ---------------------------------------------------------------------------
// Self-test -- REAL symlinks, not a model of one
// ---------------------------------------------------------------------------

/**
 * The cases that matter here cannot be written as string comparisons, because
 * the bug IS the difference between what node puts in `argv[1]` and what it
 * puts in `import.meta.url`. So the fixture spawns a real probe module through
 * a real symlink and reads what it printed.
 *
 * A model of a symlink would have passed against every one of the eleven
 * broken spellings this module replaces.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const SELF = fileURLToPath(import.meta.url);

  // ── the predicate, directly ────────────────────────────────────────────────
  t('an absent argv[1] is not this module -- the `node --eval` importer', !invokedAs(undefined, SELF) && !invokedAs('', SELF));
  t('an exact path is this module', invokedAs(SELF, SELF));
  t('a relative path resolving to this module is this module', invokedAs(relative(process.cwd(), SELF), SELF));
  t('an unrelated existing file is not this module', !invokedAs(resolve(SELF, '..', 'js-comment-mask.mjs'), SELF));
  t('an entry path that cannot be read is not this module (no throw)', !invokedAs(resolve(SELF, '..', 'no-such-file-here.mjs'), SELF));

  // ── the fixture: a probe reached three ways ────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), 'invoked-as-'));
  try {
    // A directory whose name needs percent-encoding, because two of the
    // replaced spellings went inert on exactly this with no symlink involved.
    const deep = join(dir, 'a#b c');
    mkdirSync(deep, { recursive: true });

    const probe = join(deep, 'probe.mjs');
    writeFileSync(
      probe,
      `import { isEntrypoint } from ${JSON.stringify(pathToFileURL(SELF).href)};\n` +
        `if (isEntrypoint(import.meta.url)) console.log('RAN');\n`,
    );

    const sameName = join(dir, 'probe.mjs');
    const diffName = join(dir, 'not-the-same-name.mjs');
    symlinkSync(probe, sameName);
    symlinkSync(probe, diffName);

    const run = (f) => {
      const r = spawnSync(process.execPath, [f], { encoding: 'utf8' });
      return { out: (r.stdout || '').trim(), status: r.status };
    };

    const direct = run(probe);
    t('a probe run directly RUNS', direct.out === 'RAN' && direct.status === 0, JSON.stringify(direct));

    // THE case. Every spelling this module replaces failed here, silently.
    const viaSame = run(sameName);
    t('a probe reached through a SYMLINK runs', viaSame.out === 'RAN' && viaSame.status === 0, JSON.stringify(viaSame));

    // ...and not because the basenames happen to match: the two basename
    // spellings that were replaced pass the case above and fail this one.
    const viaDiff = run(diffName);
    t('a probe reached through a symlink under a DIFFERENT NAME runs', viaDiff.out === 'RAN' && viaDiff.status === 0, JSON.stringify(viaDiff));

    // The importer direction: the guard must stay false, or a module runs its
    // whole CLI inside someone else's process. This is the direction the
    // basename spellings got wrong.
    const importer = join(dir, 'importer.mjs');
    writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(probe).href)});\nconsole.log('IMPORTED');\n`);
    const imported = run(importer);
    t('importing the probe does NOT run it', imported.out === 'IMPORTED' && imported.status === 0, JSON.stringify(imported));

    // `node <dir>` — the entry argument, and only it, gets directory
    // resolution, so the index module must recognise the DIRECTORY as itself.
    const pkgDir = join(dir, 'as-a-directory');
    mkdirSync(pkgDir, { recursive: true });
    // `node <dir>` reaches the index through package.json `main` — the
    // directory alone is not enough, which is why this leg needs a real fixture.
    writeFileSync(join(pkgDir, 'package.json'), '{"type":"module","main":"index.mjs"}\n');
    writeFileSync(
      join(pkgDir, 'index.mjs'),
      `import { isEntrypoint } from ${JSON.stringify(pathToFileURL(SELF).href)};\n` +
        `if (isEntrypoint(import.meta.url)) console.log('RAN');\n`,
    );
    const viaDir = run(pkgDir);
    t('a directory run as `node <dir>` RUNS its index', viaDir.out === 'RAN' && viaDir.status === 0, JSON.stringify(viaDir));

    // ...including when the importer shares the probe's basename, which is
    // precisely what basename matching cannot tell apart.
    const twinDir = join(dir, 'twin');
    mkdirSync(twinDir, { recursive: true });
    const twin = join(twinDir, 'probe.mjs');
    writeFileSync(twin, `await import(${JSON.stringify(pathToFileURL(probe).href)});\nconsole.log('IMPORTED');\n`);
    const viaTwin = run(twin);
    t('an importer sharing the probe basename does NOT run it', viaTwin.out === 'IMPORTED' && viaTwin.status === 0, JSON.stringify(viaTwin));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ invoked-as self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`✓ invoked-as self-test: ${cases.length} cases pass (real symlink, different-name symlink, percent-encoding path, and both import directions).`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  console.log('usage: node scripts/invoked-as.mjs --self-test');
}
