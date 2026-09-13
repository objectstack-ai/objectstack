// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The POSITIVE CONTROL for `published-entry-node-env-source-reroute.test.ts`
 * (#12271): it defeats `bin/run.js`'s `settings.enableAutoTranspile = false`
 * from inside the child, so the suite can watch the defect reproduce.
 *
 * ## Why a control is not optional here
 *
 * Every assertion in that file is an ABSENCE — the CLI did not reroute to
 * `src/`, the card's signature did not appear, the exit code was 0. An absence
 * passes just as well over a fixture that arms nothing: a `tsconfig.json` whose
 * `paths` entry never matched, a trap module that resolves fine, a probe
 * command that loads no command modules. Every one of those would be green, and
 * green for the wrong reason, forever. So one leg has to make the SAME fixture,
 * on the SAME entry, under the SAME environment, fail — and the only difference
 * between the legs is this file.
 *
 * ## Why it is a preload and not an edit
 *
 * The alternative is mutating `bin/run.js` on disk and putting it back, which
 * is a real edit to a shared worktree from inside a test run — the failure mode
 * being a crashed or timed-out run that leaves the entry point neutralised for
 * every later reader. Nothing here touches disk: the process exits and the
 * neutralisation is gone with it.
 *
 * ## ⚠️ Why a getter/setter pair and not a plain write
 *
 * `--import` runs BEFORE the entry, and the entry then assigns `false` — so a
 * preload that simply wrote `true` would be overwritten a moment later and the
 * control would silently not fire. Making the property non-writable instead
 * would make that assignment THROW, because `bin/run.js` is ESM and therefore
 * strict mode. An accessor whose setter ignores writes is the one shape that
 * absorbs the entry's assignment without either losing to it or crashing it,
 * and leaves `@oclif/core` reading `undefined` — exactly the value it saw
 * before the declaration existed, so the leg reproduces the ORIGINAL defect
 * rather than some third state.
 */
const { settings } = await import('@oclif/core');

Object.defineProperty(settings, 'enableAutoTranspile', {
  get: () => undefined,
  set: () => {},
  configurable: true,
});
