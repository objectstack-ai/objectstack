// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two ways to invoke this CLI wrong that used to present as a CRASHED BOOT
 * (#10111, carved from the #10087 finding), and the shapes that make each one
 * read as what it actually is.
 *
 * Both were measured while a checklist runner booted the showcase app, and both
 * cost the same thing: the reader went and debugged the APPLICATION, because
 * nothing in what they saw said the failure happened before anything started.
 *
 *   1. `node packages/cli/dist/index.js` — the package `main`, which is a
 *      re-export barrel — ran to completion, printed nothing, and exited 0.
 *      Backgrounded, that is indistinguishable from a server that came up and
 *      died: the process is gone, nothing is listening, and every instinct for
 *      "did it start?" (exit code, stderr) answers yes.
 *   2. `objectstack dev --no-ui` fails the oclif parse (`dev` has a `--ui` flag
 *      but, unlike `serve`, no `allowNo`), and oclif answers with the error line
 *      followed by a full usage dump. In a background log the dump is what the
 *      eye lands on, and the one sentence that matters scrolls past unread.
 *
 * ⛔ Fixing (2) by teaching `dev` to accept `--no-ui` is deliberately NOT what
 * this module does: that widens the public CLI flag surface and is a product
 * decision, not a diagnosability one. Nothing here adds or removes an accepted
 * input — it only changes what the CLI SAYS when it rejects one.
 *
 * ## Why this file imports nothing but `node:` builtins
 *
 * `bin/run.js` and `bin/run-dev.js` reach it from the failure path, where the
 * budget is one small module and no side effects. Pulling `./format.js` for
 * {@link CLI_NAME} would drag chalk, zod and `@objectstack/spec` into a shim
 * whose whole job is to print one line and get out of the way, so the prefix is
 * spelled locally and `invocation.cli-name-parity.test.ts` fails if the two
 * spellings ever disagree.
 */

import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The prefix every line here starts with — the same name as `format.ts`'s
 * `CLI_NAME`, kept in sync by a test rather than by an import (see the module
 * docstring). It leads the line so that a `grep objectstack:` over a runner log
 * finds the sentence, which is the only reading a backgrounded failure gets.
 */
export const INVOCATION_PREFIX = 'objectstack';

/** `realpathSync`, degrading to the input for a path that does not exist. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Is this module the process ENTRY POINT — the thing `node <path>` was pointed
 * at — rather than a module someone imported?
 *
 * ⚠️ The obvious spelling of this predicate is the bug it guards against.
 * #10086 measured the `invokedDirectly` guard across `scripts/` in ELEVEN distinct
 * spellings over 33 files — the measurement, not the "~8" estimate this header
 * carried until #10269 — and NINE of the eleven were wrong. The dominant family is
 * some form of `resolve(argv[1]) === fileURLToPath(import.meta.url)`, and every
 * member of it answers **false** when the script is reached through a symlink —
 * because node resolves symlinks for the module graph but leaves `process.argv[1]`
 * exactly as the caller typed it. A guard used the usual way ("only run when
 * invoked directly") then makes its script silently inert: exit 0, no output. That
 * is precisely the defect this module exists to remove, so reproducing it here
 * would have been the same bug wearing the fix's clothes.
 *
 * Two things follow, and both are load-bearing:
 *
 *   • the symlink leg — compare the `realpathSync` of both sides, which is the
 *     shape #10086 recommends and PR #10084 pinned with a real symlink fixture;
 *   • the DIRECTORY leg — `node <dir>` resolves the entry to `<dir>/index.js`
 *     for the entry argument only, so `argv[1]` can name the directory whose
 *     index this module is. Same failure class, same silent 0.
 *
 * A false NEGATIVE here is the silent no-op. A false POSITIVE would abort a
 * legitimate `import '@objectstack/cli'`, so the comparison stays exact — no
 * basename matching, which #10086 also found in the wild and which fires for
 * any entry script that happens to share a filename.
 *
 * @param entryArg `process.argv[1]` — undefined under `node --eval` / the REPL
 * @param selfUrl  the caller's `import.meta.url`
 */
export function isProcessEntry(entryArg: string | undefined, selfUrl: string): boolean {
  if (!entryArg) return false;

  let self: string;
  try {
    self = resolve(fileURLToPath(selfUrl));
  } catch {
    return false;
  }

  const entry = resolve(entryArg);
  // `node <dir>` — the entry argument, and only it, still gets directory
  // resolution. `index.ts` is here for the `tsx bin/run-dev.js` / source-run
  // path, where this same module is reached before any build.
  const candidates = [entry, join(entry, 'index.js'), join(entry, 'index.mjs'), join(entry, 'index.ts')];
  if (candidates.includes(self)) return true;

  const realSelf = realOrSelf(self);
  return candidates.some((candidate) => realOrSelf(candidate) === realSelf);
}

/**
 * What the barrel says when it was run instead of imported.
 *
 * Line one is the whole fix: it has to be legible on its own, because the run
 * that hits this is backgrounded and nobody reads line two. Line two names the
 * real entry point, which is the question the reader is actually holding.
 *
 * @param selfPath the file that was run, absolute
 * @param binPath  `packages/cli/bin/run.js`, absolute
 */
export function moduleEntryMisuseLines(selfPath: string, binPath: string): [string, string] {
  return [
    `${INVOCATION_PREFIX}: NOT A CLI ENTRY POINT — ${selfPath} only re-exports the command classes, so running it starts nothing and exits.`,
    `${INVOCATION_PREFIX}: the CLI entry point is ${binPath} (installed as \`objectstack\` / \`os\`) — e.g. \`node ${binPath} dev\`.`,
  ];
}

/**
 * Is this one of oclif's ARGUMENT errors — a failure that happened while
 * parsing the invocation, before the command ran at all?
 *
 * Structural rather than `instanceof`: `@oclif/core` does not export
 * `CLIParseError` (`lib/parser/errors.js` is not in the package's `exports`
 * map), and reaching into an unexported path to type-test would be a worse
 * coupling than reading two own properties its constructor always sets. The
 * corpus this is checked against is the REAL parser's output —
 * `invocation.test.ts` throws the errors through `Parser.parse`, the public
 * entry point, instead of hand-rolling look-alikes.
 */
export function isInvocationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const own = Object.prototype.hasOwnProperty;
  // Both are class fields on `CLIParseError`; `parse` alone would also match a
  // plain object that happens to carry parsed input.
  return own.call(error, 'parse') && own.call(error, 'showHelp');
}

/** The first line of a message, with oclif's `See more help with --help` tail dropped. */
function reasonOf(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  const first = String(typeof message === 'string' ? message : '').split('\n')[0]?.trim() ?? '';
  return first || 'invalid arguments';
}

/** The invocation as typed, capped so one long argument cannot push the line into a wrap. */
function invocationOf(argv: readonly string[]): string {
  const joined = [INVOCATION_PREFIX, ...argv].join(' ');
  return joined.length > 120 ? `${joined.slice(0, 117)}...` : joined;
}

/**
 * The ONE line that goes to stderr ahead of oclif's own error-plus-usage dump
 * when the CLI rejected the invocation.
 *
 * Three properties, each of them the reason a usage dump was not enough:
 *
 *   • It is FIRST. `handle()` writes the error and then the usage sections, and
 *     when stderr is a pipe those writes are asynchronous and `process.exit`
 *     can tear the process down mid-drain — so the earliest bytes are the ones
 *     that survive a truncated log as well as an unread one.
 *   • It is ONE line. A backgrounded runner's log is skimmed, not read.
 *   • It says the command never ran. That is the correct attribution the
 *     #10087 finding is about: without it the reader sees a dead process and no
 *     listener, concludes the server booted and died, and goes off to debug an
 *     application that was never started.
 *
 * @returns the line, or `undefined` when the error is not an invocation error —
 *   a genuine runtime failure keeps oclif's reporting exactly as it was.
 */
export function invocationFailureLine(error: unknown, argv: readonly string[]): string | undefined {
  if (!isInvocationError(error)) return undefined;
  return `${INVOCATION_PREFIX}: INVOCATION ERROR — ${reasonOf(error)}. The command never ran: nothing was started and nothing is listening. Invoked as: ${invocationOf(argv)}`;
}
