// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execSync } from 'child_process';
import dotenvFlow from 'dotenv-flow';
import fs from 'fs';
import path from 'path';
import { normalizeStackInput } from '@objectstack/spec';
import { printHeader, printSuccess, printWarning, printError, printStep, printInfo } from '../utils/format.js';
import { loadConfig, configExists } from '../utils/config.js';
import { checkSpecVersionGap } from '../utils/spec-version.js';
// #5644 — "the optional package is not installed" and "it is installed and
// will not load" are two facts, and one `catch` around `import()` cannot tell
// them apart. That classification lives in one place, with the measurements
// behind it written down there.
import { loadOptionalPackage } from '../utils/optional-package.js';
import { validateWidgetBindings } from '@objectstack/lint';
import {
  resolveTenancyPosture,
  collectGlobalUniques,
  unconfirmedGlobalUniques,
  describeGlobalUniqueFinding,
  postureGatesGlobalUniques,
  GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION,
  type GlobalUniqueFinding,
} from '@objectstack/types';
// The posture vocabulary, read from the package that DEFINES it (#5382) — the
// fix list below enumerates the accepted values, and a second literal list
// would be free to drift the day a posture is added.
import { TENANCY_POSTURES, type TenancyPosture } from '@objectstack/spec/security';

interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

/**
 * The ONE way a `HealthCheckResult` reaches the terminal (#5403).
 *
 * Extracted from the environment block's `forEach` so that a finding produced
 * later in the report — after that loop has already run — can still be printed
 * the same way, instead of reaching for a bare `printWarning` and quietly
 * inventing a second rendering with its own rules. The config-load failure was
 * exactly that second rendering: a naked one-liner with no name column and,
 * crucially, no `fix` channel, so `--verbose` had nothing to expand and the
 * operator had no flag that could reveal more.
 *
 * `fix` shows unasked only for an `error`: an error's remedy is not optional
 * reading, a warning's detail is.
 */
function renderHealthCheckResult(result: HealthCheckResult, verbose: boolean): void {
  const padded = result.name.padEnd(20);
  if (result.status === 'ok') {
    printSuccess(`${padded} ${result.message}`);
  } else if (result.status === 'warning') {
    printWarning(`${padded} ${result.message}`);
  } else {
    printError(`${padded} ${result.message}`);
  }

  if (result.fix && (verbose || result.status === 'error')) {
    console.log(chalk.dim(`      → ${result.fix}`));
  }
}

// ─── Environment sources (#5387, #5397) ─────────────────────────────
//
// `serve` / `dev` / `start` all load `.env*` through dotenv-flow before they
// read a single `OS_*` variable (`serve.ts:520`, `dev.ts`, `start.ts`); doctor
// read none. So a value living in a committed `.env` — the most common home for
// exactly these variables, and the reason PR #5381 put serve's posture gate
// AFTER the dotenv load — reached the server and never reached the diagnostic:
// doctor green, `os serve` refusing to boot the same directory.
//
// Doctor now reads the same cascade, with two deliberate constraints:
//
//   • It does NOT merge the values into `process.env` for the run. The overlay
//     is applied around each read that needs it and taken back off in a
//     `finally` (`withDotenvOverlay` / `withDotenvOverlayAsync`), so nothing
//     outside those windows — a spawned tool, whatever runs next in the same
//     process — silently inherits a different environment than the one it
//     inherited yesterday.
//   • Every env-derived value is REPORTED WITH ITS SOURCE (shell vs which
//     file). A silent merge would trade "doctor cannot see your `.env`" for
//     "doctor cannot tell you which of your four `.env*` files it believed",
//     which is the same class of defect one layer along.
//
// #5397 added the second such window: `loadConfig()`. It is listed here rather
// than left implicit because a user's `objectstack.config.ts` reads whatever
// variables it likes — not just `DOCTOR_ENV_INPUTS` — so the config load is the
// one place where the whole cascade, not a declared subset, reaches a reader.
// `environmentSourcesCheck` names the files for exactly that reason: the set of
// variables cannot be enumerated in advance, but the files that supplied them
// can, and an unreported overlay of an unbounded key set would be the silent
// merge in its worst form.

/**
 * The environment variables doctor's own checks derive from.
 *
 * Every entry's PROVENANCE is reported by {@link environmentSourcesCheck} — the
 * variable's name and where its value came from, **never the value itself**.
 * Reporting the source rather than the contents is what keeps this list safe to
 * grow: a future env-derived check whose variable carries a credential can be
 * declared here without doctor printing the credential. (The one value doctor
 * does print is an *unrecognized* `OS_TENANCY_POSTURE`, quoted back by the
 * posture finding so the operator can see their typo — a posture is a
 * vocabulary word, not a secret.)
 *
 * A new env-derived check MUST add its variable here: `doctor-env-provenance.test.ts`
 * fails when `doctor.ts` names an `OS_*` variable this list does not declare.
 * Reading `.env` into a check that reports no attribution is precisely the
 * defect #5387 closed, and it would otherwise creep back one variable at a time.
 */
export const DOCTOR_ENV_INPUTS = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED'] as const;

/** Where one environment value actually came from. */
export interface EnvValueProvenance {
  name: string;
  /** `'shell'` — this process's environment; `'file'` — a `.env*` file; `'unset'` — neither. */
  source: 'shell' | 'file' | 'unset';
  /** Absolute path of the winning `.env*` file. Only when `source === 'file'`. */
  file?: string;
}

/** What doctor found when it read the `.env*` cascade `os serve` reads. */
export interface DotenvReading {
  /** The `node_env` the cascade was resolved for. */
  nodeEnv: string;
  /** The directory the cascade was read from (doctor's cwd). */
  cwd: string;
  /** Existing `.env*` files in dotenv-flow's ASCENDING priority order. */
  files: string[];
  /** varname → merged value across `files` (later file wins). */
  fileValues: Map<string, string>;
  /** varname → the highest-priority file that defines it. */
  fileOrigin: Map<string, string>;
  /** A file dotenv-flow could not read. `os serve` (silent: true) ignores this. */
  error?: { file: string; message: string };
}

/**
 * The `node_env` doctor resolves the `.env*` cascade for.
 *
 * Identical to `serve.ts:517-519` with its `--dev` flag out of the picture —
 * doctor has no such flag, and the PM ruling on #5387 explicitly declined to
 * invent one for this first version. serve's remaining expression is
 * `NODE_ENV === 'test' ? 'test' : (NODE_ENV || 'production')`, whose first
 * branch is a no-op once `flags.dev` is false, so this really is the same
 * derivation and not a lookalike.
 *
 * Read from `process.env` only, never from a `.env*` file — a `NODE_ENV` set
 * inside a `.env` cannot change which files are loaded under serve either
 * (serve computes the mode before the load), and mirroring that is the point.
 */
export function doctorNodeEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.NODE_ENV || 'production';
}

/**
 * Say out loud that `NODE_ENV` is unset — and that the whole stack is therefore
 * treating this environment as **production** (#5673).
 *
 * `undefined` when the variable is set, so a configured environment gets no row
 * at all. That is the same shape the tenancy-posture finding has: a value doctor
 * is happy with is not a finding, and doctor's output for every explicitly
 * configured environment is unchanged by this addition.
 *
 * ── Why the unset case deserves a row ────────────────────────────────────
 *
 * `production` is the conservative default and, since #5673, every reader
 * agrees on it: `os start` forces `NODE_ENV='production'` when unset
 * (`start.ts:248`), `os serve` resolves its `.env*` cascade for
 * `NODE_ENV || 'production'` (`serve.ts:532-533`), {@link doctorNodeEnv} is the
 * same expression, and the `/discovery` `environment` field now advertises
 * `production` too (`packages/runtime/src/http-dispatcher.ts`).
 *
 * Agreement is what makes the default SAFE. It is not what makes it VISIBLE.
 * An operator who never set the variable cannot tell an intended production
 * deployment from an oversight, and those two want opposite follow-ups — one is
 * finished, the other is a local shell about to be told it is production. The
 * maintainer's 2026-08-06 ruling on #5673 asked for exactly this: the default
 * state should be loud, not merely documented.
 *
 * A `warning`, never an `error`. Nothing is broken: the environment starts, and
 * it starts in the mode this row names. `error` is what turns doctor's summary
 * into `process.exit(1)`, and an unset `NODE_ENV` must not fail a health check.
 *
 * ── Deliberately NOT in `DOCTOR_ENV_INPUTS`, and not read through the overlay ─
 *
 * That list is for variables whose value doctor resolves through the `.env*`
 * cascade. `NODE_ENV` is the one variable that cannot come from a file: it
 * SELECTS the cascade (`.env.production` vs `.env.development`), so `os serve`
 * reads it from the process before any file is loaded and a `NODE_ENV=` line
 * inside a `.env` never reaches this decision. Attributing it to a file would
 * report something the runtime does not do — see {@link doctorNodeEnv}'s note.
 *
 * "Unset" here is `!env.NODE_ENV`, character for character the condition under
 * which {@link doctorNodeEnv} falls back to its default. The row therefore
 * appears exactly when the default was taken, which is the only claim it makes.
 */
export function nodeEnvCheck(env: NodeJS.ProcessEnv = process.env): HealthCheckResult | undefined {
  if (env.NODE_ENV) return undefined;

  return {
    name: 'NODE_ENV',
    status: 'warning',
    message: 'Not set — this environment is being treated as production',
    fix:
      'Set it explicitly so the mode is a decision rather than a default:\n'
      + '      • production deployment → NODE_ENV=production (what `os start` already forces)\n'
      + '      • local development     → NODE_ENV=development (what `os dev` already sets)\n'
      + '      Unset reads as production everywhere: `os serve` and `os doctor` resolve the\n'
      + '      `.env*` cascade for node_env=production, and the /discovery `environment` field\n'
      + '      advertises "production" (#5673). That is the safe direction — a client asking\n'
      + '      "am I talking to production?" is never told "development" by an omission — but\n'
      + '      it also makes an oversight look identical to a deliberate production deployment,\n'
      + '      and this row is the only place the difference is visible.\n'
      + '      NODE_ENV cannot be supplied by a `.env*` file: it SELECTS which of those files\n'
      + '      load, so it is read from the process before any of them.',
  };
}

/**
 * Read — without loading — the `.env*` files `os serve` would load from `cwd`.
 *
 * `dotenvFlow.listFiles()` is the same function `dotenvFlow.config()` uses to
 * pick its files, so the list is serve's list by construction rather than by a
 * reimplemented naming convention. Files are parsed one at a time (instead of
 * `parse(files)`, which merges them) purely so each variable keeps the name of
 * the file it won in: that per-key attribution is the whole deliverable.
 */
export function readDotenvFiles(cwd: string, nodeEnv: string): DotenvReading {
  const reading: DotenvReading = {
    nodeEnv,
    cwd,
    files: [],
    fileValues: new Map(),
    fileOrigin: new Map(),
  };

  try {
    reading.files = dotenvFlow.listFiles({ node_env: nodeEnv, path: cwd });
  } catch (err) {
    reading.error = { file: cwd, message: err instanceof Error ? err.message : String(err) };
    return reading;
  }

  // Ascending priority: a later file overwrites an earlier one, which is
  // exactly how `dotenvFlow.parse(list)` merges them.
  for (const file of reading.files) {
    let parsed: Record<string, string>;
    try {
      parsed = dotenvFlow.parse(file);
    } catch (err) {
      reading.error = { file, message: err instanceof Error ? err.message : String(err) };
      continue;
    }
    for (const [name, value] of Object.entries(parsed)) {
      reading.fileValues.set(name, value);
      reading.fileOrigin.set(name, file);
    }
  }

  return reading;
}

/**
 * Where `name`'s effective value comes from, under serve's precedence.
 *
 * dotenv-flow's `load()` skips any variable `process.env` already **has** —
 * `hasOwnProperty`, not truthiness — so an explicitly empty shell value beats a
 * populated `.env`. The same test is used here on purpose: a provenance report
 * that disagreed with the loader on `FOO=` would be a second convention.
 */
export function provenanceOf(
  reading: DotenvReading,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvValueProvenance {
  if (Object.prototype.hasOwnProperty.call(env, name)) return { name, source: 'shell' };
  const file = reading.fileOrigin.get(name);
  if (file) return { name, source: 'file', file };
  return { name, source: 'unset' };
}

/**
 * The value a reader would see for `name` under serve's precedence.
 *
 * Deliberately separate from {@link provenanceOf}: provenance is what doctor
 * PRINTS, and keeping the value out of that structure is what makes the report
 * safe for a future secret-bearing input. The value is fetched only where it is
 * genuinely needed — quoting an unrecognized posture back at the operator.
 */
export function effectiveEnvValue(
  reading: DotenvReading,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, name)) return env[name];
  return reading.fileValues.get(name);
}

/** A `.env*` path as the operator typed it — relative to cwd when it lives there. */
function displayEnvFile(reading: DotenvReading, file: string): string {
  const rel = path.relative(reading.cwd, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

/** One line of provenance, in the operator's vocabulary. Names the source, not the value. */
export function describeProvenance(reading: DotenvReading, provenance: EnvValueProvenance): string {
  switch (provenance.source) {
    case 'shell':
      return `${provenance.name} from this process's environment`;
    case 'file':
      return `${provenance.name} from ${displayEnvFile(reading, provenance.file!)}`;
    default:
      return `${provenance.name} not set`;
  }
}

/**
 * The attribution sentence a finding about a single variable carries: where the
 * value came from, and which files were consulted to decide that.
 *
 * Written for the `fix` block's 6-space continuation indent. `source: 'unset'`
 * cannot reach here from a finding — a variable nobody set produces no
 * complaint — and is folded into the process-environment wording rather than
 * given a fourth sentence nothing can print.
 */
function envSourceSentence(reading: DotenvReading, provenance: EnvValueProvenance): string {
  const loaded = reading.files.map((file) => displayEnvFile(reading, file)).join(', ');

  if (provenance.source === 'file') {
    return `Read from ${displayEnvFile(reading, provenance.file!)} — \`os doctor\` loaded the same \`.env*\` cascade\n`
      + `      \`os serve\` does (node_env=${reading.nodeEnv}: ${loaded}).`;
  }
  if (reading.files.length > 0) {
    return `Read from this process's environment, which overrides the \`.env*\` files doctor also\n`
      + `      read (node_env=${reading.nodeEnv}: ${loaded}) — the precedence \`os serve\` resolves.`;
  }
  return `Read from this process's environment; no \`.env*\` file exists in ${reading.cwd}\n`
    + `      (node_env=${reading.nodeEnv}), so \`os serve\` would find none here either.`;
}

/**
 * The variables `dotenvFlow.config()` would ADD to this process — i.e. the ones
 * the shell has not already defined.
 */
function dotenvOverlay(
  reading: DotenvReading,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const overlay: Record<string, string> = {};
  for (const [name, value] of reading.fileValues) {
    if (!Object.prototype.hasOwnProperty.call(env, name)) overlay[name] = value;
  }
  return overlay;
}

/**
 * Run `fn` with the `.env*` overlay in `process.env`, then take it back off.
 *
 * Needed because the readers doctor must agree with — `resolveTenancyPosture()`
 * in `@objectstack/types` — read `process.env` themselves. Reimplementing their
 * resolution over a plain map instead would give doctor a *second* copy of a
 * vocabulary `@objectstack/types` owns, free to drift from the one `os serve`
 * enforces; that is the failure #5382 was careful to avoid when it quoted the
 * resolver's own sentence rather than paraphrasing it.
 *
 * So the mutation is real but bounded: only variables the shell does NOT define
 * (dotenv-flow's own precedence), only for the duration of a synchronous call,
 * and removed in a `finally` — using dotenv-flow's own `unload()` test, which
 * deletes a variable only when it still holds the value that was written, so a
 * value `fn` deliberately changed is left alone.
 *
 * For an asynchronous reader — the config bundle, whose top level runs inside a
 * dynamic `import()` — use {@link withDotenvOverlayAsync}. This one takes the
 * overlay back off the moment `fn` RETURNS, which for an async `fn` is the
 * moment it hands back a pending promise, i.e. before it has read anything.
 */
export function withDotenvOverlay<T>(reading: DotenvReading, fn: () => T): T {
  const overlay = dotenvOverlay(reading);
  const applied = applyDotenvOverlay(overlay);
  try {
    return fn();
  } finally {
    revertDotenvOverlay(overlay, applied);
  }
}

/**
 * {@link withDotenvOverlay} for a reader that finishes asynchronously (#5397).
 *
 * Doctor's other consumer of the cascade is `loadConfig()`, and a user's
 * `objectstack.config.ts` typically reads its environment at MODULE TOP LEVEL —
 * a datasource URL, a feature switch, sometimes a `throw` when the value is
 * missing. That top level runs inside `bundleRequire`'s dynamic `import()`, so
 * it happens one or more microtasks after `loadConfig()` was called. The
 * synchronous wrapper's `finally` fires when the call returns its pending
 * promise, which is strictly BEFORE the config file has been bundled, let alone
 * evaluated: it would apply an overlay nothing ever reads and revert it before
 * the read. Hence a real `await` inside the `try` rather than a second call
 * shape that merely looks equivalent.
 *
 * Everything else is deliberately identical to the synchronous wrapper — same
 * overlay set, same dotenv-flow `unload()` revert test, same revert-on-throw —
 * because both share {@link applyDotenvOverlay} / {@link revertDotenvOverlay}
 * rather than restating the policy. Two hand-written copies of "which variables
 * doctor is allowed to touch, and when it puts them back" is exactly the drift
 * #5387 spent its length arguing against.
 *
 * The window is still bounded, and its bound is worth naming: the overlay is
 * live for the config file's LOAD, not for the checks that run on the loaded
 * object afterwards. Everything doctor analyses is a plain value read out of
 * the module at evaluation time, so this covers the real reads; a config that
 * deferred an environment read to a lazy getter invoked later would fall
 * outside it. That is the same restraint as the synchronous case — doctor never
 * leaves a merged environment lying around for whatever runs next — not an
 * oversight.
 */
export async function withDotenvOverlayAsync<T>(
  reading: DotenvReading,
  fn: () => Promise<T>,
): Promise<T> {
  const overlay = dotenvOverlay(reading);
  const applied = applyDotenvOverlay(overlay);
  try {
    return await fn();
  } finally {
    revertDotenvOverlay(overlay, applied);
  }
}

/** Write the overlay into `process.env`. Returns the names actually written. */
function applyDotenvOverlay(overlay: Record<string, string>): string[] {
  const names = Object.keys(overlay);
  for (const name of names) process.env[name] = overlay[name];
  return names;
}

/**
 * Take the overlay back off, using dotenv-flow's own `unload()` test: delete a
 * variable only while it still holds the value that was written, so a value the
 * callback deliberately changed survives.
 */
function revertDotenvOverlay(overlay: Record<string, string>, applied: string[]): void {
  for (const name of applied) {
    if (process.env[name] === overlay[name]) delete process.env[name];
  }
}

/**
 * The report line that says what doctor read, and where each declared
 * environment input came from (#5387).
 *
 * Printed on every run, including a clean one. That is the point: after this
 * change doctor's env-derived checks answer "what will `os serve` see", and a
 * report that consults four files without naming them has only moved the
 * blind spot from "doctor never read my `.env`" to "which `.env` did doctor
 * believe?".
 *
 * #5397 widened the cascade's reach from doctor's own declared inputs to the
 * config file's load, and this line remains the ONE place that says so. The
 * variables a user's `objectstack.config.ts` reads are the user's, not
 * `DOCTOR_ENV_INPUTS`, so they are not enumerated here — but the files that
 * supplied them are, which is what makes the wider overlay a reported fact
 * rather than the silent merge #5387 refused.
 */
export function environmentSourcesCheck(
  reading: DotenvReading,
  env: NodeJS.ProcessEnv = process.env,
): HealthCheckResult {
  const loaded = reading.files.map((file) => displayEnvFile(reading, file));
  const provenances = DOCTOR_ENV_INPUTS.map((name) => provenanceOf(reading, name, env));
  const set = provenances.filter((p) => p.source !== 'unset');

  const where = loaded.length > 0
    ? `${loaded.join(', ')} (node_env=${reading.nodeEnv}), the cascade \`os serve\` loads`
    : `No .env* files here (node_env=${reading.nodeEnv}) — environment read from this process only`;
  const attribution = set.length > 0
    ? ` — ${set.map((p) => describeProvenance(reading, p)).join(', ')}`
    : ' — no environment input set';

  const detail =
    'Where each environment input doctor reads comes from:\n'
    + provenances
      .map((p) => `        • ${describeProvenance(reading, p)}`)
      .join('\n')
    + '\n      A variable set in this process wins over every `.env*` file, and a later file in\n'
    + '      the cascade wins over an earlier one — the same precedence `os serve` resolves.\n'
    + '      Sources only: doctor reports where a value came from, never what it is.\n'
    + '      These files are also applied while objectstack.config.ts is loaded, so a config\n'
    + '      that reads process.env at top level sees the values `os serve` gives it.';

  if (reading.error) {
    return {
      name: 'Environment files',
      status: 'warning',
      message: `${displayEnvFile(reading, reading.error.file)} could not be read — its values are missing from this report`,
      // serve loads with `silent: true`, so it says nothing at all about an
      // unreadable file and simply boots without those values. Doctor's job is
      // to say so out loud; the verdict stays a warning because the environment
      // still starts.
      fix:
        `${reading.error.message}\n`
        + '      `os serve` ignores an unreadable `.env*` file silently and boots without those\n'
        + '      values, so this is a real difference between what you wrote and what runs.\n'
        + `      ${detail}`,
    };
  }

  return {
    name: 'Environment files',
    status: 'ok',
    message: `${where}${attribution}`,
    fix: detail,
  };
}

// ─── Tenancy Posture ────────────────────────────────────────────────

/**
 * One-line descriptions of the accepted postures, keyed by the vocabulary
 * `@objectstack/spec/security` owns. A posture declared there but not described
 * here is still listed by the fix list (bare, without prose) rather than
 * silently dropped — the advice can go terse, never stale.
 */
const TENANCY_POSTURE_FIX_HINTS: Readonly<Record<string, string>> = {
  single: 'one organization, no organization wall — the default',
  group: 'organization wall enforced by the open engine, one shared database',
  isolated:
    'organization wall + the enterprise @objectstack/organizations runtime '
    + "(the legacy spelling 'multi' is accepted and normalizes to this)",
};

/**
 * What doctor's tenancy-posture read decided (#5382).
 *
 * A verdict object rather than a throw. `resolveTenancyPosture()` refuses an
 * unrecognized value by throwing, and doctor's every posture read used to sit
 * inside the broad config-analysis `try` — so the refusal arrived as
 * `⚠ Could not load config for analysis`, a warning, about the wrong subject,
 * with exit code 0. A verdict cannot be caught by an unrelated `catch`.
 */
export type TenancyPostureReading =
  | { ok: true; posture: TenancyPosture }
  | { ok: false; result: HealthCheckResult };

/**
 * Resolve the environment's requested tenancy posture, or produce the
 * health-check finding that reports an unrecognized value (#5382).
 *
 * `resolveTenancyPosture()` (`@objectstack/types`) is the authority on the
 * vocabulary and already refuses an unrecognized value — this wrapper does NOT
 * re-decide that. It changes HOW the refusal travels and what it says.
 *
 * Why it exists: doctor read the posture in two places
 * (`findUnscopedGlobalUniques()` and the ADR-0120 D5e gate), both of them under
 * the wide `try` that guards config analysis, whose `catch` prints
 * `Could not load config for analysis (config checks skipped)` and counts a
 * WARNING. An environment that `os serve` flatly refuses to boot was therefore
 * reported by `os doctor` as "functional", exit 0, without the string
 * `OS_TENANCY_POSTURE` appearing anywhere in the run — sending the operator to
 * look at their config, which was fine. That is the "diagnostic surface
 * disagrees with the runtime" class of #4801 / cloud#1020, landed on the very
 * command an operator reaches for after `serve` fails.
 *
 * The counterpart in `serve.ts` (`resolveTenancyPostureOrRefusal`, #5359) has
 * the same shape but a different verdict, and deliberately so: serve REFUSES
 * (FATAL + `process.exit(1)` before any boot work), doctor REPORTS (an `error`
 * health check that flows through doctor's own error summary).
 *
 * #5387 — the INPUT is now the `.env*` cascade serve reads, not the shell
 * alone. `resolveTenancyPosture()` reads `process.env` itself, so the overlay is
 * applied around that one call and removed again (see {@link withDotenvOverlay});
 * the finding then names the file (or the shell) the value actually came from,
 * because "OS_TENANCY_POSTURE is wrong" is only half an answer when four files
 * could have set it.
 */
export function resolveTenancyPostureOrFinding(reading: DotenvReading): TenancyPostureReading {
  try {
    return { ok: true, posture: withDotenvOverlay(reading, () => resolveTenancyPosture()) };
  } catch (err) {
    // Read back through the reading, not `process.env`: the overlay is already
    // off by the time this runs (the `finally` above), so `process.env` would
    // report the shell's value — `undefined` — for a posture that came from a
    // `.env` file, quoting the operator a value they never typed.
    const raw = effectiveEnvValue(reading, 'OS_TENANCY_POSTURE');
    const provenance = provenanceOf(reading, 'OS_TENANCY_POSTURE');
    const cause = err instanceof Error ? err.message : String(err);
    const fixes = TENANCY_POSTURES.map((posture) => {
      const hint = TENANCY_POSTURE_FIX_HINTS[posture];
      return `        • OS_TENANCY_POSTURE=${posture}${hint ? ` — ${hint}` : ''}`;
    }).join('\n');
    return {
      ok: false,
      result: {
        name: 'Tenancy posture',
        status: 'error',
        message:
          `OS_TENANCY_POSTURE=${JSON.stringify(String(raw ?? ''))} is not a recognized tenancy posture`
          + ' — `os serve` refuses to boot this environment',
        fix:
          'Set one of the accepted values:\n'
          + `${fixes}\n`
          + '        • or unset OS_TENANCY_POSTURE entirely — the posture then derives from\n'
          + '          OS_MULTI_ORG_ENABLED (true ⇒ isolated, anything else ⇒ single)\n'
          // Attribution, not a disclaimer. This sentence used to read "unlike
          // `os serve`, `os doctor` does not load `.env*` files, so a value set
          // in one is not visible here" — honest at the time (#5382) and the
          // reason #5387 was filed. Doctor now reads the same cascade, so the
          // sentence states what it READ: the file (or the shell) this value
          // came from, and the files it consulted to decide that.
          + `      ${envSourceSentence(reading, provenance)}\n`
          // The resolver owns the vocabulary and its wording; quoting rather
          // than paraphrasing keeps doctor from maintaining a second copy that
          // can disagree with it.
          + `      cause: ${cause}`,
      },
    };
  }
}

// ─── Config-Aware Checks ────────────────────────────────────────────

function detectCircularDependencies(objects: any[]): string[] {
  const issues: string[] = [];
  const graph = new Map<string, string[]>();

  for (const obj of objects) {
    const deps: string[] = [];
    if (obj.fields && typeof obj.fields === 'object') {
      for (const field of Object.values(obj.fields) as any[]) {
        if (field?.type === 'lookup' && field?.reference) {
          deps.push(field.reference);
        }
      }
    }
    graph.set(obj.name, deps);
  }

  // DFS cycle detection
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      issues.push(`Circular dependency: ${cycle.join(' → ')}`);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    stack.add(node);

    for (const dep of graph.get(node) || []) {
      if (graph.has(dep)) {
        dfs(dep, [...path, node]);
      }
    }

    stack.delete(node);
    return false;
  }

  for (const name of graph.keys()) {
    if (!visited.has(name)) {
      dfs(name, []);
    }
  }

  return issues;
}

// ── Object-reference walking ────────────────────────────────────────
// A `config.views` entry is a ViewSchema CONTAINER (`{ list, form, listViews,
// formViews }` — the defineView() shape): the object binding lives on each
// sub-view at `data.object` (provider 'object'), never on a top-level
// `view.object`. Legacy flat ViewItems (top-level `object`) are still read.

function* subViewsOf(view: any): Generator<[slot: string, subView: any]> {
  if (!view || typeof view !== 'object') return;
  if (view.list) yield ['list', view.list];
  if (view.form) yield ['form', view.form];
  for (const [key, sub] of Object.entries<any>(
    view.listViews && typeof view.listViews === 'object' ? view.listViews : {},
  )) {
    yield [`listViews.${key}`, sub];
  }
  for (const [key, sub] of Object.entries<any>(
    view.formViews && typeof view.formViews === 'object' ? view.formViews : {},
  )) {
    yield [`formViews.${key}`, sub];
  }
}

function subViewObject(sub: any): string | undefined {
  if (typeof sub?.data?.object === 'string') return sub.data.object;
  if (typeof sub?.objectName === 'string') return sub.objectName;
  return undefined;
}

/** Every object name a view (container or legacy flat item) references. */
function collectViewObjectRefs(view: any): string[] {
  const refs: string[] = [];
  if (typeof view?.object === 'string') refs.push(view.object);
  for (const [, sub] of subViewsOf(view)) {
    const bound = subViewObject(sub);
    if (bound) refs.push(bound);
    // Inline master-detail children and lookup form fields are references too.
    for (const subform of Array.isArray(sub?.subforms) ? sub.subforms : []) {
      if (typeof subform?.childObject === 'string') refs.push(subform.childObject);
    }
    for (const section of Array.isArray(sub?.sections) ? sub.sections : []) {
      for (const field of Array.isArray(section?.fields) ? section.fields : []) {
        if (typeof field?.reference === 'string') refs.push(field.reference);
      }
    }
  }
  return refs;
}

/**
 * Every object name an app's navigation references. Object nav items carry
 * `objectName` (AppSchema `ObjectNavItemSchema`), nest under `children`, and
 * may live in `areas[*].navigation` instead of the top-level `navigation`.
 */
function collectAppObjectRefs(app: any): string[] {
  const refs: string[] = [];
  const walk = (items: any): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.objectName === 'string') refs.push(item.objectName);
      if (typeof item.object === 'string') refs.push(item.object);
      if (typeof item.requiresObject === 'string') refs.push(item.requiresObject);
      walk(item.children);
    }
  };
  walk(app?.navigation);
  for (const area of Array.isArray(app?.areas) ? app.areas : []) {
    walk(area?.navigation);
  }
  return refs;
}

export function findOrphanViews(config: any): string[] {
  const objectNames = new Set<string>();
  if (Array.isArray(config.objects)) {
    for (const obj of config.objects) {
      if (obj.name) objectNames.add(obj.name);
    }
  }

  const orphans: string[] = [];
  if (Array.isArray(config.views)) {
    for (const view of config.views) {
      if (typeof view?.object === 'string' && !objectNames.has(view.object)) {
        orphans.push(`View "${view.name || '?'}" references non-existent object "${view.object}"`);
      }
      for (const [slot, sub] of subViewsOf(view)) {
        const bound = subViewObject(sub);
        if (bound && !objectNames.has(bound)) {
          orphans.push(
            `View "${view?.name || sub?.label || slot}" (${slot}) references non-existent object "${bound}"`,
          );
        }
      }
    }
  }
  return orphans;
}

export function findUnusedObjects(config: any): string[] {
  const objectNames = new Set<string>();
  if (Array.isArray(config.objects)) {
    for (const obj of config.objects) {
      if (obj.name) objectNames.add(obj.name);
    }
  }

  const referencedObjects = new Set<string>();

  // Views — container sub-views (data.object), subforms, lookup form fields.
  if (Array.isArray(config.views)) {
    for (const view of config.views) {
      for (const ref of collectViewObjectRefs(view)) referencedObjects.add(ref);
    }
  }

  // Flows — the bound object lives inside node config (FlowNodeSchema.config
  // is unstructured; `object`/`objectName` is the canonical alias pair used
  // by record_change triggers and CRUD nodes).
  if (Array.isArray(config.flows)) {
    for (const flow of config.flows) {
      if (flow.trigger?.object) referencedObjects.add(flow.trigger.object);
      if (flow.object) referencedObjects.add(flow.object);
      for (const node of Array.isArray(flow?.nodes) ? flow.nodes : []) {
        const cfg = node?.config;
        if (typeof cfg?.object === 'string') referencedObjects.add(cfg.object);
        if (typeof cfg?.objectName === 'string') referencedObjects.add(cfg.objectName);
      }
    }
  }

  // Apps — navigation (top-level, nested children, and areas).
  if (Array.isArray(config.apps)) {
    for (const app of config.apps) {
      for (const ref of collectAppObjectRefs(app)) referencedObjects.add(ref);
    }
  }

  // Lookup fields reference other objects
  if (Array.isArray(config.objects)) {
    for (const obj of config.objects) {
      if (obj.fields && typeof obj.fields === 'object') {
        for (const field of Object.values(obj.fields) as any[]) {
          if (field?.type === 'lookup' && field?.reference) {
            referencedObjects.add(field.reference);
          }
        }
      }
    }
  }

  const unused: string[] = [];
  for (const name of objectNames) {
    if (!referencedObjects.has(name)) {
      unused.push(`Object "${name}" is defined but not referenced by any view, flow, app, or lookup field`);
    }
  }
  return unused;
}

// ─── ADR-0120 D5e — `isolated`-posture unique-scope advisory ────────

/**
 * The ADVISORY half of ADR-0120 D5e.
 *
 * The hard gate lives at the install seam, where the two things it needs are
 * both present: the app being installed, and an installer who can answer. It
 * structurally cannot reach two populations, and this is where those are
 * reported instead:
 *
 * 1. **Installs that predate the gate** — a ledger entry with no attestation.
 * 2. **Environments whose posture changed after install** — nothing was
 *    installed under `isolated`, so nothing was ever asked.
 *
 * Plus the case with no install seam at all: an app declared in this project's
 * own `objectstack.config.ts`, which is code, not a marketplace install.
 *
 * ⛔ This is `os doctor` / `os migrate plan`, deliberately — NOT a boot-time
 * warning. A startup diagnostic here would fire on every boot of every affected
 * deployment forever, which is the #4884 false-alarm class the ADR names by
 * number. A command someone runs on purpose is the right frequency for a
 * finding whose resolution is a human/agent decision.
 */
interface UniqueScopeAdvisory {
  /** Where the finding came from — a config-declared app, or a ledger entry. */
  source: string;
  finding: GlobalUniqueFinding;
}

/**
 * The outcome of reading the installed-package ledger (#5412).
 *
 * An empty `entries` is ambiguous on its own — it is what "nothing installed"
 * and what "the ledger could not be read" both produce — so the second case
 * carries a `failure` alongside it. The caller distinguishes them; before
 * #5412 nobody could, because one `catch` returned `[]` for both.
 */
export interface InstalledPackageLedgerReading {
  entries: any[];
  /**
   * Ledger files that exist but could not be turned into entries (#5413).
   *
   * A DIFFERENT fact from `failure` below, and both can be empty while the
   * other is not: `failure` means nothing at all was read, `skipped` means
   * some of it was. Before #5413 this list could not exist — the producer
   * dropped corrupt files inside its own un-bound `catch` and handed back a
   * short array indistinguishable from a complete one.
   */
  skipped: SkippedLedgerEntry[];
  /** Present ONLY when the ledger EXISTS and could not be read. */
  failure?: { cause: unknown };
  /**
   * Present ONLY when the package that READS the ledger is installed and could
   * not be loaded (#5644).
   *
   * A THIRD fact, one boundary above `failure`: that one is "the ledger is
   * there and I could not read it", this one is "the thing I read ledgers with
   * is there and I could not load it". Both leave the ledger unexamined; only
   * this one leaves doctor unable to say where the ledger even is, because the
   * directory name is the missing package's own constant.
   */
  readerFailure?: { cause: unknown };
  /**
   * Present ONLY when the reader package LOADED and its
   * `DEFAULT_INSTALLED_PACKAGES_DIR` export is not a string (#5996).
   *
   * A FOURTH fact — the last cell of the edge #5644 carved. `readerFailure` is
   * "present but unloadable"; this is "loaded but unrecognizable". That export
   * is the single authority on where the ledger lives, so a reading in this
   * state carries no `dir` and read no directory at all: the `??` fallback
   * that used to guess `.objectstack/installed-packages` in its place was the
   * tolerant consumer read Prime Directive #12 forbids, two lines from the
   * #5413 comment saying so. `received` is what the export actually was.
   */
  dirAuthorityMissing?: { received: unknown };
  /**
   * The resolved ledger directory — `cwd` joined with the producer's
   * `DEFAULT_INSTALLED_PACKAGES_DIR` export (#5996). Present exactly when that
   * export was read successfully, whatever happened afterwards (a `failure`
   * reading still carries it); absent when the reader never loaded
   * (`readerFailure`) or loaded without declaring it (`dirAuthorityMissing`).
   * Rows that name the directory take it from HERE, never from a re-hardcoded
   * literal: the literal is the consumer restating what only the producer
   * decides.
   */
  dir?: string;
}

/**
 * One unreadable ledger file, as `@objectstack/cloud-connection` reports it.
 *
 * Structurally identical to that package's `SkippedManifestEntry`, declared
 * here rather than imported because the package is loaded through a dynamic
 * `import()` that must be allowed to fail (`os doctor` runs in checkouts that
 * never had it), so there is no static type import to take.
 */
interface SkippedLedgerEntry {
  file: string;
  cause: unknown;
}

/**
 * Read the installed-package ledger without going through HTTP.
 *
 * Two failures live here, and they are NOT the same fact (#5412):
 *
 *   1. `@objectstack/cloud-connection` does not resolve — the optional package
 *      is not installed. Silence is correct and deliberate: `os doctor` must
 *      run to completion in a checkout that never had it.
 *   2. The ledger directory EXISTS (`fs.existsSync` already said so) and
 *      reading it threw — the path is not a directory, the filesystem refused,
 *      the entry list could not be produced. Something IS there and doctor did
 *      not read it.
 *
 * One un-bound `catch` covered both and returned `[]` for both, so case 2
 * reached the D5e advisory as "no installed packages" and the report printed
 * `✓ Unique scope`. A false PASS is worse than a missing check, because it
 * tells the operator to stop looking. Case 2 now comes back as a `failure` the
 * caller turns into a warning row.
 *
 * There is a THIRD fact, one layer down, and it is now reported too (#5413).
 * A single CORRUPT ENTRY never reaches this `catch` and never will:
 * `LocalManifestSource.list()` skips unparseable files in its own per-file
 * `catch` (`packages/cloud-connection/src/local-manifest-source.ts`), which is
 * the right behaviour — one truncated manifest must not stop a runtime from
 * booting the packages that are fine. It used to skip them silently, returning
 * a short list indistinguishable from a complete one, so doctor printed
 * `✓ Unique scope` over packages it had never parsed: the same false PASS as
 * case 2, one layer down. Fixing it from here would have meant re-implementing
 * the producer's parsing rules in the consumer — the lenient-consumer
 * workaround this repo forbids — so `list()` was changed to REPORT what it
 * skipped, and this function passes that through as `skipped`.
 *
 * And a FOURTH, one boundary ABOVE case 1 (#5644). Case 1 says "the specifier
 * does not resolve"; the `catch` that implemented it said "the `import()`
 * threw", which is not the same sentence. A package that IS installed and will
 * not load — a pruned or unbuilt `dist/`, an interrupted install, an artefact
 * that throws while it evaluates — threw too, and was answered with the silence
 * meant for a package that was never there. The ledger went unread with no
 * trace, and the report printed `✓ Unique scope` for the third time in this
 * function's history: now over a reader it could not even start. The two are
 * separated by `loadOptionalPackage()` (`utils/optional-package.ts` carries how,
 * and the measurements behind it); only the genuinely-absent half stays silent.
 *
 * And a FIFTH — the cell the fourth's edge left uncovered (#5996). `loaded` is
 * still not RECOGNIZED: the ledger directory's name is the module's own
 * `DEFAULT_INSTALLED_PACKAGES_DIR` export — the single authority on that name —
 * and a module that evaluates fine while declaring no such string is a reader
 * this doctor does not know how to follow. The consumer-side `??` that used to
 * sit on that export answered the state with a hard-coded guess, two lines
 * above the #5413 comment that forbids exactly that accommodation (Prime
 * Directive #12), while the runtime kept reading wherever the package decides —
 * two reports, potentially two directories, no line saying so. The guess is
 * gone: the state comes back as `dirAuthorityMissing`, and no directory —
 * guessed or otherwise — is read while it holds.
 *
 * Called UNCONDITIONALLY since #5429 — from `run()`, outside the tenancy-posture
 * gate and outside the config-analysis block. Two consequences worth knowing:
 * every finding above is now reachable under every posture (which is the whole
 * point), and this function no longer sits inside a `try` belonging to somebody
 * else. It must therefore report rather than throw for anything it can hit,
 * which is why the export is TYPE-CHECKED before `path.join()` ever sees it
 * (#5996): the join over two known strings cannot throw. Before the check
 * existed, the same hazard was handled positionally — the join lived INSIDE the
 * guarded block, because a `path.join()` over a non-string export used to be
 * absorbed by the config `catch` and misreported as "Could not load config for
 * analysis". The named reading replaces both the guess and the throw.
 */
async function readInstalledPackageEntries(cwd: string): Promise<InstalledPackageLedgerReading> {
  // Dynamic, like serve.ts's cloud-connection load: `os doctor` must still run
  // in a checkout where the optional package is not resolvable.
  const load = await loadOptionalPackage('@objectstack/cloud-connection');
  // Case 1, and ONLY case 1, is allowed to be silent: no package is here, so
  // nothing was installed through it and nothing went unchecked.
  if (load.state === 'absent') return { entries: [], skipped: [] };
  // Case 4. Reported whether or not a ledger directory exists: doctor cannot
  // honestly claim there is no ledger when the constant naming the ledger's
  // location is an export of the package that would not load. Gating this row
  // on `fs.existsSync()` is the rejected option B of #5644 — it reads "has
  // anything ever been installed" as a proxy for "should this package be here".
  if (load.state === 'broken') {
    return { entries: [], skipped: [], readerFailure: { cause: load.cause } };
  }
  const mod: any = load.module;

  // Case 5 (#5996) — LOADED is not RECOGNIZED. This export is the single
  // authority on what the ledger directory is called, and a module that
  // evaluates fine without declaring it (as a string) is not a reader this
  // doctor knows how to follow. Read with no `??` fallback for the same reason
  // the destructuring below has none (Prime Directive #12): the guess the
  // fallback used to make is the consumer restating what only the producer
  // decides, and the runtime keeps reading wherever the package says — so the
  // guess could put doctor and the runtime on two different directories, both
  // silent. No guessed directory is read; the state is its own named row.
  const declaredDir: unknown = mod.DEFAULT_INSTALLED_PACKAGES_DIR;
  if (typeof declaredDir !== 'string') {
    return { entries: [], skipped: [], dirAuthorityMissing: { received: declaredDir } };
  }
  // Outside the `try` on purpose: both operands are known strings, so this
  // join cannot throw, and resolving it here keeps `dir` in scope for every
  // return below — including the `failure` one.
  const dir = path.join(cwd, declaredDir);

  try {
    // No directory = nothing was ever installed. Genuinely not a finding.
    if (!fs.existsSync(dir)) return { entries: [], skipped: [], dir };
    // #5413 — read BOTH halves of the listing. Destructured with no `??`
    // fallback on purpose: `list()` declares this shape, and a tolerant read
    // here would be the exact consumer-side accommodation that let the silence
    // live in the first place.
    const { entries, skipped } = new mod.LocalManifestSource(dir).list();
    return { entries, skipped, dir };
  } catch (err) {
    return { entries: [], skipped: [], dir, failure: { cause: err } };
  }
}

/**
 * Whether a ledger reading covers everything it was supposed to (#5412 / #5413
 * / #5644 / #5996).
 *
 * The D5e advisory's success line is a claim about BOTH of its halves, so any
 * of the four ways the ledger half can come back short must withhold it. The
 * four are reported as their own rows, by their own check, above — this
 * predicate is only about what the ADVISORY may still claim.
 */
function ledgerReadingIsComplete(reading: InstalledPackageLedgerReading): boolean {
  return (
    !reading.failure
    && !reading.readerFailure
    && !reading.dirAuthorityMissing
    && reading.skipped.length === 0
  );
}

/**
 * Collect every unanswered installation-wide unique this environment would run
 * under `isolated`. Returns an empty list under every other posture: there
 * `'global'` is the correct, unambiguous meaning (`single` = one customer;
 * `group` = the installation IS the customer company).
 *
 * The advisory has TWO halves — this project's own metadata, and the installed
 * packages in the ledger.
 *
 * #5429 — the ledger half's ENTRIES arrive here already read, and its FAILURES
 * are no longer this function's business at all. It used to call
 * `readInstalledPackageEntries()` itself and hand three failure facts back for
 * the caller to render, which is what locked those three rows inside this
 * posture gate: under `single` and `group` the first line below returned before
 * the read ever happened. The read is now unconditional and lives in `run()`,
 * `installedPackageLedgerChecks()` renders it, and this function is left with
 * the one judgment that genuinely depends on the posture. That is also the
 * dedup: one read, one set of rows, no second reporter.
 */
function findUnscopedGlobalUniques(
  config: any,
  // #5382 — the posture the caller already resolved, not a fresh parse. This
  // function runs inside doctor's broad config-analysis `try`, so a
  // `resolveTenancyPosture()` here is a throw the wrong `catch` reports as
  // "Could not load config for analysis".
  posture: TenancyPosture,
  ledgerEntries: any[],
): UniqueScopeAdvisory[] {
  if (!postureGatesGlobalUniques(posture)) return [];

  const out: UniqueScopeAdvisory[] = [];
  for (const finding of collectGlobalUniques(config?.objects)) {
    out.push({ source: 'this project’s metadata', finding });
  }

  for (const entry of ledgerEntries) {
    const findings = collectGlobalUniques(entry?.manifest?.objects);
    // Subtract what the install ceremony already answered for — an attested
    // install must not be re-reported, or the advisory becomes the recurring
    // nag the gate exists to avoid.
    for (const finding of unconfirmedGlobalUniques(findings, entry?.globalUniqueAttestation, posture)) {
      out.push({ source: `installed package '${entry?.manifestId ?? entry?.packageId}'`, finding });
    }
  }
  return out;
}

// ─── Filesystem Checks ──────────────────────────────────────────────

function walkDir(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function findMissingTests(cwd: string): string[] {
  const specSrcDir = path.join(cwd, 'packages/spec/src');
  if (!fs.existsSync(specSrcDir)) return [];

  const missing: string[] = [];
  const zodFiles = walkDir(specSrcDir, '.zod.ts');

  for (const zodFile of zodFiles) {
    const testFile = zodFile.replace('.zod.ts', '.test.ts');
    if (!fs.existsSync(testFile)) {
      const relZod = path.relative(specSrcDir, zodFile);
      const relTest = path.relative(specSrcDir, testFile);
      missing.push(`Missing test: ${relTest} (for ${relZod})`);
    }
  }
  return missing;
}

function findDeprecatedUsages(cwd: string): string[] {
  const specSrcDir = path.join(cwd, 'packages/spec/src');
  if (!fs.existsSync(specSrcDir)) return [];

  const deprecated: string[] = [];
  const tsFiles = walkDir(specSrcDir, '.ts')
    .filter((f) => !f.endsWith('.test.ts'));

  for (const tsFile of tsFiles) {
    try {
      const content = fs.readFileSync(tsFile, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(specSrcDir, tsFile);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('@deprecated')) {
          deprecated.push(`${relPath}:${i + 1} — @deprecated tag found`);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return deprecated;
}

// ─── Deprecated Pattern Detection ───────────────────────────────────

const DEPRECATED_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
  replacement: string;
}> = [
  {
    pattern: /\bEnhancedObjectKernel\b/,
    description: 'EnhancedObjectKernel is deprecated in v3',
    replacement: 'Use ObjectKernel instead',
  },
  {
    pattern: /\bmax_length\b/,
    description: 'snake_case config key: max_length',
    replacement: 'Use maxLength (camelCase)',
  },
  {
    pattern: /\bdefault_value\b/,
    description: 'snake_case config key: default_value',
    replacement: 'Use defaultValue (camelCase)',
  },
  {
    pattern: /\bmin_length\b/,
    description: 'snake_case config key: min_length',
    replacement: 'Use minLength (camelCase)',
  },
  {
    // `referenceFilters` was REMOVED from FieldSchema (#2377 / ADR-0049); its
    // successor is `lookupFilters` (read by the objectui LookupField picker).
    // Pointing at the removed key sent authors to a silently-stripped spelling.
    pattern: /\breference_filters\b|\breferenceFilters\b/,
    description: 'retired lookup-scoping key: reference_filters / referenceFilters',
    replacement: 'Use lookupFilters (camelCase) — `referenceFilters` was removed in #2377',
  },
  {
    pattern: /\bunique_name\b/,
    description: 'snake_case config key: unique_name',
    replacement: 'Use uniqueName (camelCase)',
  },
  {
    pattern: /from\s+['"]@objectstack\/core\/enhanced['"]/,
    description: 'Import from deprecated @objectstack/core/enhanced path',
    replacement: "Use import from '@objectstack/core'",
  },
  {
    pattern: /from\s+['"]@objectstack\/spec\/dist\/[^'"]+['"]/,
    description: 'Import from deprecated @objectstack/spec/dist/ deep path',
    replacement: "Use import from '@objectstack/spec'",
  },
];

function scanDeprecatedPatterns(dir: string): Array<{ file: string; line: number; description: string; replacement: string }> {
  const results: Array<{ file: string; line: number; description: string; replacement: string }> = [];
  if (!fs.existsSync(dir)) return results;

  const tsFiles = walkDir(dir, '.ts').filter(f => !f.endsWith('.test.ts'));

  for (const tsFile of tsFiles) {
    try {
      const content = fs.readFileSync(tsFile, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(process.cwd(), tsFile);

      for (let i = 0; i < lines.length; i++) {
        for (const dp of DEPRECATED_PATTERNS) {
          if (dp.pattern.test(lines[i])) {
            results.push({
              file: relPath,
              line: i + 1,
              description: dp.description,
              replacement: dp.replacement,
            });
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return results;
}

// ─── Config load ────────────────────────────────────────────────────

/**
 * Quote what was thrown, without paraphrasing it (#5403).
 *
 * Same posture as the tenancy-posture finding's `cause:` line: the thrower owns
 * the wording. A config file's failure can come from four different authorities
 * — the user's own `throw`, esbuild's bundle diagnostics, Node's module
 * resolution, or `loadConfig()`'s own "no default export" — and doctor is not
 * in a position to summarise any of them better than they summarise themselves.
 */
function describeThrown(err: unknown): string {
  if (err instanceof Error) {
    // An `Error` thrown with no message still identifies itself by name.
    // Quoting `''` would print a headline that trails off into nothing.
    return err.message.trim().length > 0 ? err.message : err.name;
  }
  return String(err);
}

/**
 * How much of the cause the single report row carries before `--verbose`.
 * The full text always survives in `fix`; this bound only keeps one aligned
 * line aligned.
 */
const REPORT_ROW_HEADLINE_MAX = 160;

/**
 * Fold a possibly multi-line cause onto the one line a report row is.
 *
 * Named for the ROW rather than for the config load since #5412 — the
 * installed-package ledger's failure quotes its cause through the same fold,
 * and a helper called `configLoadHeadline` reading a filesystem error would be
 * the first line of drift between the two.
 *
 * Whitespace-collapsing, not rewriting: esbuild's failures open with
 * `Build failed with 1 error:` and put the file, line and reason on the NEXT
 * line, so a naive "first line" would quote the least informative sentence it
 * has. Every word is upstream's, in upstream's order; only the line breaks and
 * an overlong tail are ours.
 */
function reportRowHeadline(cause: string): string {
  const collapsed = cause.replace(/\s+/g, ' ').trim();
  return collapsed.length <= REPORT_ROW_HEADLINE_MAX
    ? collapsed
    : `${collapsed.slice(0, REPORT_ROW_HEADLINE_MAX - 1)}…`;
}

/** Keep a multi-line quote under the report's `      → ` gutter. */
function indentUnderGutter(text: string): string {
  return text.split('\n').join('\n      ');
}

/**
 * What doctor reports when `objectstack.config.ts` cannot be loaded (#5403).
 *
 * The `catch` this replaces took no binding at all — `catch {` — so the error
 * object was discarded where it was caught, and the run printed
 * `Could not load config for analysis (config checks skipped)` and nothing
 * else. No flag could reveal more: the sentence came from a bare
 * `printWarning`, not from a `HealthCheckResult`, so `--verbose` had no `fix`
 * to expand. `os serve`, in the same directory, prints the whole error. The
 * diagnostic command was returning strictly less than the command it exists to
 * diagnose, at the one moment it is most needed.
 *
 * Three deliberate choices:
 *
 *   • **Still a warning.** #5382 → #5387 → #5397 spent three issues making this
 *     sentence's attribution true; #5403 is about what it SAYS, not how loudly.
 *     Doctor keeps running the rest of its checks and keeps exiting 0.
 *   • **The sentence is unchanged.** It survives verbatim as the head of
 *     `message` — two changesets quote it, four comments in this file cite it,
 *     and operators grep for it. #5403 adds everything after the dash.
 *   • **The cause is in `message`, not only in `fix`.** `Environment files`
 *     puts its cause in `fix` alone, and that is right there: the row already
 *     states its own finding in full and the cause is a footnote. Here the
 *     cause IS the finding — without it the row says only that something
 *     unnamed went wrong — so a default run carries a bounded quote and
 *     `--verbose` carries the untruncated one.
 */
export function configLoadFailureCheck(err: unknown): HealthCheckResult {
  const cause = describeThrown(err);
  return {
    name: 'Config load',
    status: 'warning',
    message: `Could not load config for analysis (config checks skipped) — ${reportRowHeadline(cause)}`,
    fix:
      '`os serve` loads this same file the same way — bundle-require, under the `.env*`\n'
      + '      cascade named above (#5397) — and prints this error in full, so a config that\n'
      + '      lands here is one the server cannot boot either.\n'
      + '      The config-aware checks were SKIPPED, not passed: spec version, circular\n'
      + '      dependencies, unused objects, orphan views, dashboard integrity.\n'
      + `      cause: ${indentUnderGutter(cause)}`,
  };
}

/**
 * The name column every installed-package-ledger readability row takes (#5429).
 *
 * It used to be `Unique scope`, and that was right while these rows only
 * existed inside the ADR-0120 D5e advisory: the row an operator scanned for had
 * to be PRESENT and not a `✓`, so a readability failure wore the advisory's
 * name rather than leaving it missing.
 *
 * #5429 made the readability check posture-independent, and `Unique scope`
 * stopped being true. Under `single` and `group` there IS no unique-scope
 * question — `'global'` is unambiguous there — so a row named for it would
 * announce a check that does not run under that posture and never did. These
 * rows now say what they are actually about: the installed packages, and
 * whether doctor could read them at all.
 *
 * The `Unique scope` name still exists, still under the D5e block, and still
 * belongs to the unique-scope verdict alone.
 */
const LEDGER_ROW_NAME = 'Installed packages';

/**
 * What doctor reports when the installed-package ledger cannot be read (#5412).
 *
 * The ADR-0120 D5e advisory is the sum of two halves — this project's declared
 * metadata, and the manifests of packages installed into this runtime. The
 * ledger half used to fail into the same un-bound `catch` that absorbs "the
 * optional package is not installed", so a directory that existed and could
 * not be read produced an empty entry list, the advisory found nothing to say,
 * and the report printed:
 *
 *     ✓ Unique scope          No unconfirmed installation-wide uniques for
 *                             this 'isolated' environment
 *
 * An environment WITH installed packages got a clean bill of health for the
 * exact constraint the posture makes dangerous. Per this repo's "absence must
 * be loud" rule the success line is now withheld and this row takes its place.
 *
 * Three deliberate choices, mirroring `configLoadFailureCheck`:
 *
 *   • **Warning, not error.** The environment still runs; what is broken is
 *     doctor's ability to see part of it. Doctor keeps going and keeps exiting
 *     0, exactly as it does for a config it cannot load.
 *   • **It takes the {@link LEDGER_ROW_NAME} name column** — `Unique scope`
 *     until #5429 moved the check out from under the posture gate; see that
 *     constant for why the name had to move with it.
 *   • **The cause is quoted, not paraphrased** (#5390 / #5403). `ENOTDIR: not
 *     a directory, scandir '…'` names the file that is in the way; no sentence
 *     doctor could invent would beat it.
 *   • **`dir` is the directory doctor actually read** (#6643) — resolved from
 *     `DEFAULT_INSTALLED_PACKAGES_DIR` and carried on the reading, exactly as
 *     its `skipped` sibling takes it since #5996. It used to open with a
 *     re-hardcoded ``.objectstack/installed-packages/`` literal "under the
 *     project root": the consumer restating a value only the producer decides,
 *     and — since the resolved directory is `cwd`-joined — a vaguer answer than
 *     the one doctor was holding. A row reporting an unreadable directory owes
 *     the reader the directory it actually tried.
 */
export function installedPackageLedgerFailureCheck(err: unknown, dir: string): HealthCheckResult {
  const cause = describeThrown(err);
  return {
    name: LEDGER_ROW_NAME,
    status: 'warning',
    message: `Could not read the installed-package ledger (installed packages NOT checked) — ${reportRowHeadline(cause)}`,
    fix:
      `The ledger is \`${dir}\`; it exists here, which is why\n`
      + '      this is reported rather than treated as "nothing was ever\n'
      + '      installed". Every package it lists is one\n'
      + '      this runtime ALSO cannot rehydrate at boot — not registered with the\n'
      + '      kernel, absent from the console’s installed-apps list — so an app missing\n'
      + '      from this environment is very likely in there.\n'
      + '      Under the `isolated` tenancy posture it costs the ADR-0120 D5e advisory\n'
      + '      half its input too: that check has two halves and only one of them ran.\n'
      + '      Uniques declared by THIS project’s metadata were checked; uniques declared\n'
      + '      by INSTALLED PACKAGES were not looked at, which is why no `✓ Unique scope`\n'
      + '      line appears.\n'
      + `      cause: ${indentUnderGutter(cause)}`,
  };
}

/**
 * What doctor reports when INDIVIDUAL ledger entries could not be parsed
 * (#5413).
 *
 * The sibling of `installedPackageLedgerFailureCheck` one layer down. That one
 * fires when the ledger DIRECTORY could not be read at all; this one fires when
 * the directory read fine and some of the files in it did not. Both produce the
 * same false PASS if unreported — `✓ Unique scope` over manifests doctor never
 * parsed — and both therefore take the {@link LEDGER_ROW_NAME} name column and
 * withhold that success line, for the reasons written out above.
 *
 * Why entry-level corruption is a finding at all, rather than something the
 * producer just handles: skipping a corrupt file IS correct — one truncated
 * manifest must not stop a runtime booting. But an unparsed manifest is a
 * manifest nobody can vouch for, and this advisory's whole subject is
 * installation-wide `unique` constraints that are dangerous under `isolated`.
 * "It probably didn't declare one" is not an answer doctor is entitled to give.
 *
 * Two shape choices worth the words:
 *
 *   • **Every file is named, with its own cause.** A single count ("2 entries
 *     skipped") would send the operator to `ls` the directory and guess. The
 *     fix for this finding is per-file — repair it or delete it — so the row
 *     has to carry which file, and `EACCES` vs `Unexpected end of JSON input`
 *     are different repairs.
 *   • **The row quotes the FIRST cause; `fix` carries them all** (#5390 body).
 *     One row is one line, the same bound every other finding here respects.
 *   • **`dir` is the directory doctor actually read** — the one resolved from
 *     `DEFAULT_INSTALLED_PACKAGES_DIR`, handed down through the reading
 *     (#5996). It used to be a re-hardcoded `.objectstack/installed-packages/`
 *     literal: the same guess the deleted `??` fallback made, i.e. the
 *     consumer restating what only the producer decides. A row that names
 *     files to repair owes the reader the directory they are really in.
 */
export function installedPackageLedgerSkippedEntriesCheck(
  skipped: SkippedLedgerEntry[],
  dir: string,
): HealthCheckResult {
  const described = skipped.map((s) => ({ file: s.file, cause: describeThrown(s.cause) }));
  const n = described.length;
  const noun = n === 1 ? 'entry' : 'entries';
  const head = described[0]!;
  const more = n > 1 ? ` (+${n - 1} more)` : '';
  return {
    name: LEDGER_ROW_NAME,
    status: 'warning',
    message:
      `${n} installed-package ledger ${noun} could not be read (those packages NOT checked) — `
      + `${reportRowHeadline(`${head.file}: ${head.cause}`)}${more}`,
    fix:
      'The ledger directory was read fine; these files inside it were not. Each one is an\n'
      + '      installed package this runtime ALSO drops at boot — it is not registered with\n'
      + '      the kernel and does not appear in the console\'s installed-apps list — so an\n'
      + '      app missing from this environment is very likely one of the files below.\n'
      + '      Repair the JSON, or delete the file to uninstall the package for real.\n'
      + `      Under \`${dir}\`:\n`
      + described
        .map((s) => `        ${s.file}\n          cause: ${indentUnderGutter(s.cause).replace(/\n/g, '\n    ')}`)
        .join('\n'),
  };
}

/**
 * What doctor reports when the package it reads ledgers THROUGH is installed
 * and will not load (#5644).
 *
 * The third sibling of `installedPackageLedgerFailureCheck`, one boundary
 * above it. That one fires when the ledger directory could not be enumerated;
 * `installedPackageLedgerSkippedEntriesCheck` fires when individual files in it
 * would not parse; this one fires when the reader itself never started. All
 * three produce the identical false PASS if unreported — `✓ Unique scope` over
 * installed packages nobody looked at — so all three take the
 * {@link LEDGER_ROW_NAME} name column, hold back that success line, and stay
 * warnings.
 *
 * What is deliberately NOT a condition here: whether
 * `.objectstack/installed-packages/` exists. Doctor does not know that it does
 * not — the directory's name is `DEFAULT_INSTALLED_PACKAGES_DIR`, an export of
 * the very package that would not load, and answering from the hard-coded
 * fallback would be doctor claiming knowledge it just lost. Making the row
 * conditional on the directory was option B of #5644 and was rejected on
 * exactly that ground: "has anything ever been installed" is not a proxy for
 * "should this package be here".
 *
 * The row exists because the ALTERNATIVE is provably worse, and was measured:
 * with the package present-but-unloadable, a ledger declaring an
 * installation-wide `unique` produced `✓ Unique scope` and the finding
 * appeared nowhere, under `--verbose` included. In-repo this state is reached
 * daily — any worktree where `packages/cloud-connection` is unbuilt — and its
 * silence is what sent #5612 chasing a report face that had never regressed.
 */
export function installedPackageLedgerReaderFailureCheck(err: unknown): HealthCheckResult {
  const cause = describeThrown(err);
  return {
    name: LEDGER_ROW_NAME,
    status: 'warning',
    message:
      'Could not load the installed-package ledger reader (installed packages NOT checked) — '
      + `${reportRowHeadline(cause)}`,
    fix:
      '`@objectstack/cloud-connection` IS installed here — its specifier resolves — and loading\n'
      + '      it threw. That package is how `os doctor` reads `.objectstack/installed-packages/`,\n'
      + '      so nothing about the installed packages was read: whether any of them is\n'
      + '      unreadable — and, under the `isolated` posture, whether any declares an\n'
      + '      installation-wide `unique` — went unasked. Doctor cannot even tell you\n'
      + '      whether a ledger is present — the directory’s name is one of that package’s\n'
      + '      exports.\n'
      + '      A checkout that never installed the package says nothing at all, so this row means\n'
      + '      the install itself is broken: reinstall it, or — in a monorepo checkout — build it\n'
      + '      (`pnpm --filter @objectstack/cloud-connection build`).\n'
      + `      cause: ${indentUnderGutter(cause)}`,
  };
}

/**
 * Say what the directory-authority export actually was, for the one row that
 * reports it missing (#5996). Nothing was THROWN in this state — the module
 * loaded fine — so this is a sibling of `describeThrown` for a received value
 * rather than a caught one.
 */
function describeMissingDirAuthority(received: unknown): string {
  if (received === undefined) {
    return 'DEFAULT_INSTALLED_PACKAGES_DIR is not among its exports';
  }
  return `DEFAULT_INSTALLED_PACKAGES_DIR is not a string (got ${typeof received}: ${String(received)})`;
}

/**
 * What doctor reports when the package it reads ledgers through LOADED and
 * does not declare where the ledger lives (#5996).
 *
 * The fourth sibling of `installedPackageLedgerFailureCheck`, and the last
 * cell of the edge #5644 carved. That issue split "present but unloadable" out
 * of absence's silence; this row is "loaded but unrecognizable": the module
 * evaluated fine and its `DEFAULT_INSTALLED_PACKAGES_DIR` export — the single
 * authority on what the ledger directory is called — is not a string. Like its
 * three siblings the row takes the {@link LEDGER_ROW_NAME} name column, makes
 * the D5e advisory withhold its `✓ Unique scope` line, and stays a warning.
 *
 * What the row replaces is not silence but a GUESS. A consumer-side `??` used
 * to answer this state by reading a hard-coded `.objectstack/installed-packages`
 * instead — two lines above the #5413 comment prohibiting exactly that
 * accommodation (Prime Directive #12). The runtime keeps reading wherever the
 * package decides, so the guess could have doctor and the runtime reporting on
 * two different directories with neither saying so; a report over the wrong
 * directory is the same false PASS as this family's other three, wearing a
 * plausible path.
 *
 * What is deliberately NOT here, in the row or behind it: any directory path.
 * The one name doctor had for the ledger is the export that just came back
 * non-string, so naming a path — any path — would be doctor claiming the
 * knowledge whose loss this row reports. Same ground as #5644's option-B
 * rejection, one cell over: while this row shows, no directory is read at all.
 */
export function installedPackageLedgerDirAuthorityMissingCheck(received: unknown): HealthCheckResult {
  const saw = describeMissingDirAuthority(received);
  return {
    name: LEDGER_ROW_NAME,
    status: 'warning',
    message:
      'The installed-package ledger reader does not declare the ledger directory (installed packages NOT checked) — '
      + reportRowHeadline(saw),
    fix:
      '`@objectstack/cloud-connection` IS installed here and it DID load — but it does not\n'
      + '      export `DEFAULT_INSTALLED_PACKAGES_DIR` as a string, and that export is the single\n'
      + '      authority on what the ledger directory is called. Doctor will not read a guessed\n'
      + '      path in its place: the ledger’s location belongs to that package — the runtime\n'
      + '      reads wherever it decides — so a guess here could have doctor and the runtime\n'
      + '      reporting on two different directories with neither saying so. Nothing about the\n'
      + '      installed packages was read; whether a ledger even exists went unasked.\n'
      + '      A package that loads without this export is not one this doctor recognizes: the\n'
      + '      installed `@objectstack/cloud-connection` and this `os` CLI disagree about that\n'
      + '      package’s export surface. Align their versions (upgrade the older of the two).\n'
      + `      saw: ${indentUnderGutter(saw)}`,
  };
}

/**
 * Every readability finding one ledger reading produced — the whole of the
 * posture-independent check #5429 promoted out of the D5e block.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * All three rows above were built inside the ADR-0120 D5e advisory, whose entry
 * condition is `postureGatesGlobalUniques(posture)` — true for `isolated` (and
 * its legacy alias `multi`), false for `single` and `group` — and
 * `findUnscopedGlobalUniques()` re-asserted the same gate on its first line. So
 * under `single` and `group`, {@link readInstalledPackageEntries} was never
 * called: a ledger that could not be read, or a file inside it that would not
 * parse, was a question `os doctor` did not ask.
 *
 * The default is the blind one. `resolveTenancyPosture()` returns `single` when
 * `OS_TENANCY_POSTURE` is unset and multi-org is off, so out of the box doctor
 * said nothing at all about a broken ledger.
 *
 * ── Why the posture is the wrong gate for THIS fact ──────────────────────
 *
 * "Is this environment's `unique: 'global'` dangerous?" is genuinely a posture
 * question: `'global'` is unambiguous under `single` (one customer) and `group`
 * (the installation IS the customer), and only `isolated` makes it a finding.
 * That gate is correct and stays exactly where it is.
 *
 * "Is there a file under `.objectstack/installed-packages/` that cannot be
 * read?" is not. It is equally true under every posture, and it means the same
 * thing under every posture: that installed app is dropped at boot. The
 * maintainer's 2026-08-06 ruling on #5429 (option A) split the two apart —
 * these rows became their own check, the D5e block kept the unique-scope
 * verdict alone.
 *
 * ── Dedup, structurally rather than by a flag ────────────────────────────
 *
 * Under `isolated` both are live, and the same bad ledger must still be
 * reported once. It is, because the ledger is read ONCE per run: `run()` reads
 * it, renders these rows, and hands the same reading to
 * {@link findUnscopedGlobalUniques}, which no longer reads or reports anything
 * about readability. There is no second read to disagree and no second row to
 * suppress. What D5e keeps is the CONSEQUENCE for its own verdict — an
 * incomplete reading still withholds its `✓ Unique scope`, because that line is
 * a claim about both halves of the advisory and only one of them ran.
 *
 * ── Not a duplicate of the boot-side warning ─────────────────────────────
 *
 * `rehydrate()` warns per corrupt entry at boot, posture-independently — the
 * runtime saying what it just dropped while starting. This is the DIAGNOSTIC
 * command: what someone runs on purpose, possibly without ever booting, to ask
 * what is wrong. #4801 / cloud#1020 are about those two faces disagreeing;
 * before #5429 they did.
 */
export function installedPackageLedgerChecks(
  reading: InstalledPackageLedgerReading,
): HealthCheckResult[] {
  // The reader never loaded, so neither the directory nor any entry was
  // reached — mutually exclusive with the rows below rather than another
  // independent one (#5644).
  if (reading.readerFailure) {
    return [installedPackageLedgerReaderFailureCheck(reading.readerFailure.cause)];
  }
  // The reader loaded and never said where the ledger is (#5996) — nothing
  // below the export read was reached, so mutually exclusive with both
  // remaining rows for the same reason as above.
  if (reading.dirAuthorityMissing) {
    return [installedPackageLedgerDirAuthorityMissingCheck(reading.dirAuthorityMissing.received)];
  }
  const out: HealthCheckResult[] = [];
  // Same invariant as the `skipped` row below, one boundary out (#6643): a
  // `failure` reading always carries the directory the failure was ABOUT.
  // `failure` is set only in the `catch` of `readInstalledPackageEntries()`,
  // and that `try` opens after `dir` is already resolved — the two are set on
  // the same return. The `!` states that where the flat reading shape cannot,
  // and the parameter stays required so this row can never quietly fall back
  // to a guessed literal.
  if (reading.failure) out.push(installedPackageLedgerFailureCheck(reading.failure.cause, reading.dir!));
  // Independent of the row above, not an `else`: `failure` means the directory
  // could not be enumerated at all, `skipped` means it enumerated fine and
  // named files inside it would not parse. Each names packages the other does
  // not (#5412 vs #5413).
  if (reading.skipped.length > 0) {
    // A reading with skipped entries always carries the directory they were
    // skipped IN: `skipped` is per-file fallout of an enumeration only the
    // resolved `dir` makes possible, and `readInstalledPackageEntries()` sets
    // both on the same return. The `!` states that invariant where the flat
    // reading shape cannot (#5996) — the parameter stays required so the row
    // can never quietly fall back to a guessed literal.
    out.push(installedPackageLedgerSkippedEntriesCheck(reading.skipped, reading.dir!));
  }
  return out;
}

// ─── Command ────────────────────────────────────────────────────────

export default class Doctor extends Command {
  static override description = 'Check development environment and configuration health';

  static override flags = {
    verbose: Flags.boolean({ char: 'v', description: 'Show detailed information' }),
    'scan-deprecations': Flags.boolean({ description: 'Scan for deprecated ObjectStack patterns' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);

    printHeader('Environment Health Check');

    const results: HealthCheckResult[] = [];

    // ── Tenancy posture (#5382) ──────────────────────────────────────
    // Resolve ONCE, here, OUTSIDE every `try` in this method.
    //
    // Placement is the whole fix. Doctor's two posture readers — the ADR-0120
    // D5e unique-scope gate and `findUnscopedGlobalUniques()` — both sat under
    // the wide config-analysis `try` further down, whose `catch` prints
    // `Could not load config for analysis (config checks skipped)` and records
    // a WARNING. So an unrecognized `OS_TENANCY_POSTURE` produced a report that
    // blamed the config (which was fine), never printed the variable's name,
    // and exited 0 under `⚠️  Environment is functional` — while `os serve`
    // refused to boot the identical environment.
    //
    // Reading it here also widens the fix past the issue's own repro: those
    // readers only ran `if (configExists())`, so an environment with no
    // `objectstack.config.ts` never read the posture at all and said nothing
    // whatsoever about it.
    //
    // Note this REPORTS rather than refuses — no `process.exit(1)` here. The
    // finding is an ordinary `error` health check, so the rest of the report
    // still runs and doctor's own summary owns the non-zero exit.
    //
    // #5387 — the posture is resolved against the `.env*` cascade `os serve`
    // reads, not this shell alone. Read here, before any check, for the same
    // reason serve loads dotenv before its gate: a posture committed to `.env`
    // is the common case, not the exotic one.
    const dotenvReading = readDotenvFiles(process.cwd(), doctorNodeEnv());
    const postureReading = resolveTenancyPostureOrFinding(dotenvReading);

    // Check Node.js version
    try {
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      
      if (majorVersion >= 18) {
        results.push({
          name: 'Node.js',
          status: 'ok',
          message: `Version ${nodeVersion}`,
        });
      } else {
        results.push({
          name: 'Node.js',
          status: 'error',
          message: `Version ${nodeVersion} (requires >= 18.0.0)`,
          fix: 'Upgrade Node.js: https://nodejs.org',
        });
      }
    } catch (error) {
      results.push({
        name: 'Node.js',
        status: 'error',
        message: 'Not found',
        fix: 'Install Node.js: https://nodejs.org',
      });
    }
    
    // Check pnpm
    try {
      const pnpmVersion = execSync('pnpm -v', { encoding: 'utf-8' }).trim();
      results.push({
        name: 'pnpm',
        status: 'ok',
        message: `Version ${pnpmVersion}`,
      });
    } catch (error) {
      results.push({
        name: 'pnpm',
        status: 'error',
        message: 'Not found',
        fix: 'Install pnpm: npm install -g pnpm@10.28.1',
      });
    }
    
    // Check TypeScript
    try {
      const tscVersion = execSync('tsc -v', { encoding: 'utf-8' }).trim();
      results.push({
        name: 'TypeScript',
        status: 'ok',
        message: tscVersion,
      });
    } catch (error) {
      results.push({
        name: 'TypeScript',
        status: 'warning',
        message: 'Not found in PATH',
        fix: 'Installed locally via pnpm',
      });
    }
    
    // Check if dependencies are installed
    const cwd = process.cwd();
    const nodeModulesPath = path.join(cwd, 'node_modules');
    
    if (fs.existsSync(nodeModulesPath)) {
      results.push({
        name: 'Dependencies',
        status: 'ok',
        message: 'Installed',
      });
    } else {
      results.push({
        name: 'Dependencies',
        status: 'error',
        message: 'Not installed',
        fix: 'Run: pnpm install',
      });
    }
    
    // Check if spec package is built
    const specDistPath = path.join(cwd, 'packages/spec/dist');
    
    if (fs.existsSync(specDistPath)) {
      results.push({
        name: '@objectstack/spec',
        status: 'ok',
        message: 'Built',
      });
    } else {
      results.push({
        name: '@objectstack/spec',
        status: 'warning',
        message: 'Not built',
        fix: 'Run: pnpm --filter @objectstack/spec build',
      });
    }
    
    // Check Git
    try {
      const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
      results.push({
        name: 'Git',
        status: 'ok',
        message: gitVersion,
      });
    } catch (error) {
      results.push({
        name: 'Git',
        status: 'warning',
        message: 'Not found',
        fix: 'Install Git for version control',
      });
    }

    // #5387 — what doctor read the environment FROM, reported before anything
    // derived from it. Unconditional: an env-derived verdict whose inputs are
    // not attributed is a verdict the operator cannot check, and after this
    // change every such verdict has four possible sources.
    results.push(environmentSourcesCheck(dotenvReading));

    // #5673 — the mode the row above was resolved FOR, when nobody chose it.
    // Placed immediately after the sources row because it answers the question
    // that row raises: `node_env=production` appears there whether the operator
    // set NODE_ENV or not, and only this row tells the two apart. Only the unset
    // case produces a row; a configured environment's report is unchanged.
    const nodeEnvFinding = nodeEnvCheck();
    if (nodeEnvFinding) {
      results.push(nodeEnvFinding);
    }

    // #5382 — the posture verdict resolved at the top of `run()`, reported here
    // among the other environment facts. Only an unrecognized value produces a
    // row: a valid posture is not a finding, and doctor's output for every
    // environment that can actually start is unchanged.
    if (!postureReading.ok) {
      results.push(postureReading.result);
    }

    // ── Installed-package ledger readability (#5429) ─────────────────
    //
    // Read ONCE per run, here, and unconditionally.
    //
    // Placement is the fix, exactly as it was for the posture reader above.
    // These rows used to be built inside the ADR-0120 D5e advisory, so
    // `readInstalledPackageEntries()` only ran under `isolated` and only when a
    // config loaded. Whether a file under `.objectstack/installed-packages/` can
    // be read is neither of those things: it is equally true under every
    // posture, it needs no config to answer, and it means the same thing every
    // time — that installed app is dropped at boot. Under `single` (the DEFAULT
    // posture) doctor said nothing about it at all.
    //
    // The same reading is handed to the D5e advisory further down instead of
    // being read a second time, which is what keeps one bad ledger to one row.
    const ledgerReading = await readInstalledPackageEntries(cwd);
    results.push(...installedPackageLedgerChecks(ledgerReading));

    // Display environment results
    let hasErrors = false;
    let hasWarnings = false;
    
    console.log('');
    results.forEach((result) => {
      // #5403 — the rendering rules live in `renderHealthCheckResult` so that
      // the config-load finding further down prints identically instead of
      // growing a second, flagless format of its own.
      renderHealthCheckResult(result, flags.verbose);

      if (result.status === 'error') hasErrors = true;
      if (result.status === 'warning') hasWarnings = true;
    });

    // ── Extended Checks ──────────────────────────────────────────────

    // Missing test files
    printStep('Checking for missing test files...');
    const missingTests = findMissingTests(cwd);
    if (missingTests.length > 0) {
      hasWarnings = true;
      for (const msg of missingTests) {
        printWarning(msg);
      }
    } else {
      printSuccess('Test coverage         All *.zod.ts files have matching tests');
    }

    // Deprecated usage detection
    printStep('Scanning for @deprecated usage...');
    const deprecatedUsages = findDeprecatedUsages(cwd);
    if (deprecatedUsages.length > 0) {
      hasWarnings = true;
      for (const msg of deprecatedUsages) {
        printWarning(`Deprecated: ${msg}`);
      }
    } else {
      printSuccess('Deprecations          No @deprecated tags found');
    }

    // Config-aware checks (only if config exists)
    if (configExists()) {
      printStep('Loading configuration for analysis...');
      try {
        // #5397 — load the config under the SAME `.env*` cascade resolved at the
        // top of `run()`, because that is the environment `os serve` hands the
        // config file. Reading `process.env` at a config's top level is ordinary
        // (a datasource URL, a feature switch), and `serve` calls
        // `dotenvFlow.config()` before it bundles the file (`serve.ts:520`), so
        // without this the two commands were analysing two different configs:
        //
        //   • quietly — a conditionally-declared object or datasource present
        //     for serve and absent for doctor, so every check below judged a
        //     shape the server never runs;
        //   • loudly — a config that throws on a missing value landed in this
        //     `catch` and printed `Could not load config for analysis`, blaming
        //     the config, while `os serve` booted the same directory. That
        //     sentence is exactly the misattribution #5382 was opened over, and
        //     #5387 closed only the half of it that doctor's own env-derived
        //     checks could see.
        //
        // `dotenvReading` — not a second `readDotenvFiles()`. One cascade
        // resolution per run is what keeps the `Environment files` line an
        // honest account of what the config load actually saw; two reads could
        // disagree the moment a `.env` is written mid-run.
        //
        // Async wrapper, deliberately: a config's top level runs inside
        // `bundleRequire`'s dynamic `import()`, so the synchronous
        // `withDotenvOverlay` would revert the overlay while `loadConfig()`'s
        // promise was still pending — applied, then removed, never read.
        const { config: rawConfig } = await withDotenvOverlayAsync(dotenvReading, () => loadConfig());
        const config: any = normalizeStackInput(rawConfig as Record<string, unknown>);

        // Spec-version drift: installed platform newer than the app declares.
        printStep('Checking platform spec version...');
        const specGap = checkSpecVersionGap(config.manifest);
        if (specGap) {
          hasWarnings = true;
          printWarning(`Platform spec         ${specGap.message}`);
          console.log(chalk.dim(`      → ${specGap.hint}`));
        } else {
          printSuccess('Platform spec         Declared specVersion is current with the installed platform');
        }

        // Circular dependency detection
        if (Array.isArray(config.objects) && config.objects.length > 0) {
          printStep('Checking for circular dependencies...');
          const cycles = detectCircularDependencies(config.objects);
          if (cycles.length > 0) {
            hasWarnings = true;
            for (const msg of cycles) {
              printWarning(msg);
            }
          } else {
            printSuccess('Dependencies          No circular references detected');
          }

          // Unused objects
          printStep('Checking for unused objects...');
          const unused = findUnusedObjects(config);
          if (unused.length > 0) {
            hasWarnings = true;
            for (const msg of unused) {
              printWarning(msg);
            }
          } else {
            printSuccess('Object usage          All objects are referenced');
          }
        }

        // ADR-0120 D5e advisory — installation-wide uniques under `isolated`.
        // Runs whenever a config loaded, whether or not it declares objects:
        // the ledger half reports installed packages this project never
        // declared.
        //
        // #5382 — reads the verdict resolved at the top of `run()`. Re-invoking
        // the resolver here is what put its throw inside this swallowing `try`
        // in the first place. An unrecognized posture skips the advisory (there
        // is no posture to gate on) and is already reported above as an error,
        // so nothing is silently lost.
        if (postureReading.ok && postureGatesGlobalUniques(postureReading.posture)) {
          printStep("Checking unique scopes against the 'isolated' tenancy posture...");
          // #5429 — the entries were read once, at the top of the run, and the
          // three ways that read can fail are already reported as their own
          // `Installed packages` rows. What is left here is the unique-scope
          // judgment itself, which is the only part of this block that depends
          // on the posture.
          const advisories = findUnscopedGlobalUniques(config, postureReading.posture, ledgerReading.entries);
          if (advisories.length > 0) {
            hasWarnings = true;
            for (const { source, finding } of advisories) {
              printWarning(`Unique scope         ${describeGlobalUniqueFinding(finding)} (${source})`);
            }
            console.log(chalk.dim(`      → ${GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION}`));
          }
          // #5412 / #5413 / #5644 — the success line is a claim about BOTH
          // halves of the advisory, so it may only be printed when the ledger
          // half was read in full: a directory that could not be enumerated, a
          // file inside it that would not parse, and a reader that never loaded
          // each leave installed packages unexamined, and any of them makes a
          // `✓` here a false PASS. That is worse than a missing check, because
          // it is the one thing that stops the operator looking further.
          //
          // #5429 — withholding it is ALL that survives here of those three
          // issues. The findings themselves are rendered once, above, by the
          // posture-independent check; re-rendering them here would report the
          // same bad ledger twice under `isolated` and not at all under the
          // other postures, which is the pair of defects this arrangement
          // replaced.
          if (advisories.length === 0 && ledgerReadingIsComplete(ledgerReading)) {
            printSuccess("Unique scope          No unconfirmed installation-wide uniques for this 'isolated' environment");
          }
        }

        // Orphan views
        if (Array.isArray(config.views) && config.views.length > 0) {
          printStep('Checking for orphan views...');
          const orphans = findOrphanViews(config);
          if (orphans.length > 0) {
            hasWarnings = true;
            for (const msg of orphans) {
              printWarning(msg);
            }
          } else {
            printSuccess('View integrity        All views reference valid objects');
          }
        }

        // Dashboard widget integrity (issue #1721) — the widget-side analogue
        // of the orphan-view pass: every widget's `dataset`, `dimensions`,
        // `values`, and chartConfig axis/series fields must resolve against
        // the declared datasets (ADR-0021).
        if (Array.isArray(config.dashboards) && config.dashboards.length > 0) {
          printStep('Checking dashboard widget integrity...');
          const widgetFindings = validateWidgetBindings(config);
          if (widgetFindings.length > 0) {
            for (const f of widgetFindings) {
              if (f.severity === 'error') {
                hasErrors = true;
                printError(`${f.where}: ${f.message}`);
              } else {
                hasWarnings = true;
                printWarning(`${f.where}: ${f.message}`);
              }
              if (flags.verbose) {
                console.log(chalk.dim(`      → ${f.hint}`));
              }
            }
          } else {
            printSuccess('Dashboard integrity   All widgets resolve datasets, dimensions, and measures');
          }
        }
      } catch (err) {
        // #5397 — still fires, and deliberately so: with the `.env*` cascade now
        // applied around the load, a config that STILL cannot be loaded is one
        // `os serve` cannot load either. What changed is that this sentence is
        // no longer reachable by a config whose only problem was that doctor
        // withheld the environment from it. Silencing the warning outright would
        // have traded a misattributed warning for no warning at all.
        //
        // #5403 — and `err` is now BOUND. This `catch` took no binding, so the
        // one artifact that could explain the failure was discarded at the
        // moment it was caught: the operator got "could not load" with no
        // subject, no flag that revealed more, and `os serve` one directory
        // over printing the whole thing. Three issues fixed this sentence's
        // attribution; this one gives it content.
        const finding = configLoadFailureCheck(err);
        // Rendered here, in place — the environment block's loop above has
        // already run, and reordering the report to route this row through it
        // would move the finding away from the step that produced it. Same
        // renderer, same `--verbose` rule, same shape as `Environment files`
        // and `Tenancy posture`; only the call site differs.
        renderHealthCheckResult(finding, flags.verbose);
        // Kept in `results` all the same, so the run's record is complete and
        // the summary's fix list stays correct if this verdict is ever raised
        // above a warning. Inert today: that list filters on `error`.
        results.push(finding);
        hasWarnings = true;
      }
    }

    // ── Deprecation Pattern Scan ─────────────────────────────────────
    if (flags['scan-deprecations']) {
      printStep('Scanning for deprecated ObjectStack patterns...');
      const scanDir = path.join(cwd, 'src');
      const deprecations = scanDeprecatedPatterns(scanDir);
      if (deprecations.length > 0) {
        hasWarnings = true;
        for (const dep of deprecations) {
          printWarning(`${dep.file}:${dep.line} — ${dep.description}`);
          if (flags.verbose) {
            console.log(chalk.dim(`      → ${dep.replacement}`));
          }
        }
        console.log('');
        printInfo(`Found ${deprecations.length} deprecated pattern(s). Run \`objectstack codemod v2-to-v3\` to auto-fix.`);
      } else {
        printSuccess('Deprecation scan      No deprecated patterns found');
      }
    }
    
    console.log('');
    
    // Summary
    if (hasErrors) {
      console.log(chalk.red('❌ Some critical issues found. Please fix them before continuing.'));
      results
        .filter(r => r.status === 'error' && r.fix)
        .forEach(r => console.log(chalk.dim(`   ${r.fix}`)));
      process.exit(1);
    } else if (hasWarnings) {
      console.log(chalk.yellow('⚠️  Environment is functional but has some warnings.'));
      console.log(chalk.dim('   Run with --verbose to see fix suggestions.'));
    } else {
      console.log(chalk.green('✅ Environment is healthy and ready for development!'));
    }
    
    console.log('');
  }
}
