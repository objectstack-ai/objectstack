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
interface InstalledPackageLedgerReading {
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
 */
async function readInstalledPackageEntries(cwd: string): Promise<InstalledPackageLedgerReading> {
  let mod: any;
  try {
    // Dynamic, like serve.ts's cloud-connection load: `os doctor` must still
    // run in a checkout where the optional package is not resolvable. THIS
    // catch, and only this one, is allowed to be silent.
    mod = await import('@objectstack/cloud-connection');
  } catch {
    return { entries: [], skipped: [] };
  }

  const dir = path.join(cwd, mod.DEFAULT_INSTALLED_PACKAGES_DIR ?? '.objectstack/installed-packages');
  try {
    // No directory = nothing was ever installed. Genuinely not a finding.
    if (!fs.existsSync(dir)) return { entries: [], skipped: [] };
    // #5413 — read BOTH halves of the listing. Destructured with no `??`
    // fallback on purpose: `list()` declares this shape, and a tolerant read
    // here would be the exact consumer-side accommodation that let the silence
    // live in the first place.
    const { entries, skipped } = new mod.LocalManifestSource(dir).list();
    return { entries, skipped };
  } catch (err) {
    return { entries: [], skipped: [], failure: { cause: err } };
  }
}

/** What `findUnscopedGlobalUniques()` hands back — findings AND completeness. */
interface UniqueScopeReading {
  advisories: UniqueScopeAdvisory[];
  /**
   * Present when the ledger half did not run. The advisory is then INCOMPLETE,
   * not clean, and the caller must not print its success line (#5412).
   */
  ledgerFailure?: { cause: unknown };
  /**
   * Ledger entries that could not be parsed (#5413). The advisory is
   * incomplete in the same way `ledgerFailure` makes it incomplete — just
   * partially rather than wholly — so it suppresses the success line too. An
   * unreadable manifest may declare an installation-wide `unique`; nobody can
   * say it does not.
   */
  skippedLedgerEntries: SkippedLedgerEntry[];
}

/**
 * Collect every unanswered installation-wide unique this environment would run
 * under `isolated`. Returns an empty list under every other posture: there
 * `'global'` is the correct, unambiguous meaning (`single` = one customer;
 * `group` = the installation IS the customer company).
 *
 * The advisory has TWO halves — this project's own metadata, and the installed
 * packages in the ledger — and #5412 is about the second half being able to
 * fail alone. When it does, the findings collected from the first half are
 * still real and are still returned; what the caller must not do is read the
 * resulting emptiness as a clean bill of health.
 */
async function findUnscopedGlobalUniques(
  cwd: string,
  config: any,
  // #5382 — the posture the caller already resolved, not a fresh parse. This
  // function runs inside doctor's broad config-analysis `try`, so a
  // `resolveTenancyPosture()` here is a throw the wrong `catch` reports as
  // "Could not load config for analysis".
  posture: TenancyPosture,
): Promise<UniqueScopeReading> {
  if (!postureGatesGlobalUniques(posture)) return { advisories: [], skippedLedgerEntries: [] };

  const out: UniqueScopeAdvisory[] = [];
  for (const finding of collectGlobalUniques(config?.objects)) {
    out.push({ source: 'this project’s metadata', finding });
  }

  const ledger = await readInstalledPackageEntries(cwd);
  for (const entry of ledger.entries) {
    const findings = collectGlobalUniques(entry?.manifest?.objects);
    // Subtract what the install ceremony already answered for — an attested
    // install must not be re-reported, or the advisory becomes the recurring
    // nag the gate exists to avoid.
    for (const finding of unconfirmedGlobalUniques(findings, entry?.globalUniqueAttestation, posture)) {
      out.push({ source: `installed package '${entry?.manifestId ?? entry?.packageId}'`, finding });
    }
  }
  return {
    advisories: out,
    skippedLedgerEntries: ledger.skipped,
    ...(ledger.failure ? { ledgerFailure: ledger.failure } : {}),
  };
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
 *   • **It takes the `Unique scope` name column.** Not a new label: the point
 *     is that the row an operator scans for is PRESENT and not a `✓`. A
 *     separately-named row would leave `Unique scope` simply missing, which is
 *     the silence this issue is about wearing a different hat.
 *   • **The cause is quoted, not paraphrased** (#5390 / #5403). `ENOTDIR: not
 *     a directory, scandir '…'` names the file that is in the way; no sentence
 *     doctor could invent would beat it.
 */
export function installedPackageLedgerFailureCheck(err: unknown): HealthCheckResult {
  const cause = describeThrown(err);
  return {
    name: 'Unique scope',
    status: 'warning',
    message:
      'Could not read the installed-package ledger (installed packages NOT checked for '
      + `installation-wide uniques) — ${reportRowHeadline(cause)}`,
    fix:
      'This check has two halves and only one of them ran. Uniques declared by THIS\n'
      + '      project’s metadata were checked and are reported above; uniques declared by\n'
      + '      INSTALLED PACKAGES were not looked at, so an installed app carrying an\n'
      + '      installation-wide `unique` would not have appeared.\n'
      + '      The ledger is the `.objectstack/installed-packages/` directory under the\n'
      + '      project root; it exists here, which is why this is reported rather than\n'
      + '      treated as "nothing was ever installed".\n'
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
 * parsed — and both therefore take the `Unique scope` name column and withhold
 * the success line, for the reasons written out above.
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
 */
export function installedPackageLedgerSkippedEntriesCheck(
  skipped: SkippedLedgerEntry[],
): HealthCheckResult {
  const described = skipped.map((s) => ({ file: s.file, cause: describeThrown(s.cause) }));
  const n = described.length;
  const noun = n === 1 ? 'entry' : 'entries';
  const head = described[0]!;
  const more = n > 1 ? ` (+${n - 1} more)` : '';
  return {
    name: 'Unique scope',
    status: 'warning',
    message:
      `${n} installed-package ledger ${noun} could not be read (those packages NOT checked `
      + `for installation-wide uniques) — ${reportRowHeadline(`${head.file}: ${head.cause}`)}${more}`,
    fix:
      'The ledger directory was read fine; these files inside it were not. Each one is an\n'
      + '      installed package this runtime ALSO drops at boot — it is not registered with\n'
      + '      the kernel and does not appear in the console\'s installed-apps list — so an\n'
      + '      app missing from this environment is very likely one of the files below.\n'
      + '      Repair the JSON, or delete the file to uninstall the package for real.\n'
      + '      Under `.objectstack/installed-packages/`:\n'
      + described
        .map((s) => `        ${s.file}\n          cause: ${indentUnderGutter(s.cause).replace(/\n/g, '\n    ')}`)
        .join('\n'),
  };
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

    // #5382 — the posture verdict resolved at the top of `run()`, reported here
    // among the other environment facts. Only an unrecognized value produces a
    // row: a valid posture is not a finding, and doctor's output for every
    // environment that can actually start is unchanged.
    if (!postureReading.ok) {
      results.push(postureReading.result);
    }

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
          const { advisories, ledgerFailure, skippedLedgerEntries } = await findUnscopedGlobalUniques(
            cwd,
            config,
            postureReading.posture,
          );
          if (advisories.length > 0) {
            hasWarnings = true;
            for (const { source, finding } of advisories) {
              printWarning(`Unique scope         ${describeGlobalUniqueFinding(finding)} (${source})`);
            }
            console.log(chalk.dim(`      → ${GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION}`));
          }
          // #5412 — the success line is a claim about BOTH halves of the
          // advisory, so it may only be printed when both halves ran. A ledger
          // that exists and could not be read is reported in its place; a
          // false `✓` here is worse than a missing check, because it is the
          // one thing that stops the operator looking further.
          //
          // #5413 — entry-level corruption is the same claim failing one layer
          // down, so it gates the `✓` in exactly the same way. The two are
          // reported independently rather than as an either/or: a directory
          // that read fine can still hold three unparseable files, and each
          // names a different package the advisory could not look at.
          if (skippedLedgerEntries.length > 0) {
            hasWarnings = true;
            renderHealthCheckResult(
              installedPackageLedgerSkippedEntriesCheck(skippedLedgerEntries),
              flags.verbose,
            );
          }
          if (ledgerFailure) {
            hasWarnings = true;
            renderHealthCheckResult(installedPackageLedgerFailureCheck(ledgerFailure.cause), flags.verbose);
          } else if (advisories.length === 0 && skippedLedgerEntries.length === 0) {
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
