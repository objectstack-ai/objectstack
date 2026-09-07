// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os i18n extract --check --json` COMPARES, and reaches the same verdict as
 * the same run without `--json` (#16600).
 *
 * ## What was wrong
 *
 * The machine face returned before anything was compared. Driven on one
 * drifted fixture, the two invocations differing ONLY by `--json`:
 *
 *     $ os i18n extract CONFIG --locales=zh-CN --no-metadata-forms --out=OUT --check
 *       missing:    OUT/zh-CN.objects.generated.ts
 *       Translation bundles have drifted from the schema. Regenerate and commit:
 *     -> exit 1
 *
 *     $ os i18n extract CONFIG --locales=zh-CN --no-metadata-forms --out=OUT --check --json
 *       {"totalExpected":775,"counts":{"zh-CN":2},"bundles":{…}}
 *     -> exit 0, with no drift field, no comparison and no failure
 *
 * The first run is the second one's positive control: the drift is provably
 * there, and the second reported success. `if (flags.json) { … return; }` sat
 * ahead of both the `--check` needs-`--out` guard and the comparison block —
 * the same shape the `--dry-run` branch had in #16480, and `--json` is if
 * anything the more likely CI spelling of the two, because a pipeline that
 * wants to parse the result reaches for it. A check that cannot fail is
 * indistinguishable from a check that finds nothing.
 *
 * ## Why these shapes
 *
 * ⚠️ A case asserting only the new exit code would be satisfied by a `--check`
 * that still compares nothing and merely fails, so every drift case here pins
 * WHAT WAS REPORTED beside the code — and the report is read out of the JSON
 * document, not out of the console text, because the document is the face this
 * card is about.
 *
 *   - the drifted cases are stated as an EQUALITY against the same invocation
 *     WITHOUT `--json`, which is the card's own method rather than a
 *     re-derivation of it, and the expected values are spelled out as well,
 *     because an equality alone is also satisfied by two runs that are both
 *     broken;
 *   - the in-sync case is what no unconditional failure can pass. ⚠️ It is NOT
 *     a falsifier for this defect and must not be read as one: before the
 *     repair, `--check --json` on an in-sync tree ALSO exited 0 carrying the
 *     payload, so this case is green on both sides of the mutation. That is
 *     the #16480 lesson in this card's own terms — an exit-code-only suite
 *     would have stayed green over the very regression it was written for —
 *     and it is why the drift cases assert the reported drift;
 *   - `--json` PURITY is asserted on every machine run: stdout has to parse as
 *     exactly ONE document. A repair that emitted the ordinary payload and
 *     then an error envelope would pass an "exit 1 and the word drifted"
 *     reading while producing output that is neither one document nor JSONL —
 *     the two-document defect `isExitSignal` records in `utils/format.ts`;
 *   - the REMEDY is pinned as well as the sentence, on its own two booleans.
 *     The drift envelope is two lines and the second one is a command; an
 *     earlier revision of this file read only the first, and a remedy that
 *     named a `--json` run — which emits a payload and writes zero files —
 *     sat green under it. Running exactly what the failure prints then heals
 *     nothing and the next `--check --json` fails identically: the #14895
 *     loop, one face over. So the remedy must name an `--out` and must not
 *     carry `--json`;
 *   - the needs-`--out` refusal is pinned because it is the OTHER thing the
 *     early return skipped: `--check --json` with no `--out` used to exit 0
 *     with a payload, having been asked for a comparison it could not make;
 *   - a plain `--json` run with no `--check` is pinned unchanged, so the
 *     repair cannot be satisfied by turning the machine face into a checker.
 *
 * ⛔ Nothing here asserts a `drift` / `missing` / `stale` MEMBER on the
 * payload. The repair routes drift through this command's existing
 * `{ error, …errorCodeFields }` envelope — the one every other failure of this
 * command already speaks — and adds no new member to a published output face.
 * Naming the drifted files in the machine payload is a widening, and a
 * widening is its own card; a case pinning one here would settle that contract
 * by test instead.
 *
 * ## Why this file is not named `.e2e`
 *
 * The `.e2e` filename tier runs NIGHTLY on `main` and not on a pull request or
 * in the merge queue (`scripts/nightly-tiers.mjs`). That is the wrong trade for
 * this card's class, for the reason its `--dry-run` sibling records: the
 * regression reads GREEN, so between reintroduction and the next nightly every
 * run of the pair reports success about a comparison that is not happening, and
 * PRs merge on top of it. Its PROJECT is still decided by what it does — it
 * spawns the CLI, so `vitest-tiers.ts` classifies it `integration` either way.
 *
 * ## Fixture placement
 *
 * The stack config goes under this package's git-ignored `tmp/` and the `--out`
 * roots in the system temp dir, for the reason `i18n-extract-check-hint.e2e`
 * records: `bundle-require` writes its bundled module next to the config, so
 * Node resolves the bare `@objectstack/spec` specifier from THAT directory, and
 * only under `packages/cli/tmp/` does that lookup reach this package's real
 * `node_modules`. `afterAll` removes only this suite's own `mkdtemp`
 * directories — several suites share that root and run concurrently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const CLI_PACKAGE_ROOT = resolve(HERE, '..');

/** One object, and a `defaultLocale` equal to the only locale asked for. */
const STACK_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },",
  "  objects: [{ name: 'kpi_metric', label: 'Metric', fields: { name: { type: 'text', label: 'Name' } } }],",
  '});',
  '',
].join('\n');

/** The one bundle this invocation commits. `--no-metadata-forms` keeps it at one. */
const BUNDLE = 'zh-CN.objects.generated.ts';
const FLAGS = ['--locales=zh-CN', '--no-metadata-forms'];

/** The first line of the sentence both faces end a drifted `--check` on. */
const DRIFTED = 'Translation bundles have drifted from the schema.';
/** The refusal a `--check` with no `--out` ends on, on both faces. */
const NEEDS_OUT = '--check needs --out=<dir>';

let fixtureRoot: string;
let outRoot: string;
let CONFIG: string;
/** An `--out` whose committed bundle is in sync — written once, copied per case. */
let syncedOut: string;

/** Text with SGR sequences removed — chalk is off through a pipe, belt and braces. */
function plain(text: string): string {
  // The escape byte is SPELLED, never embedded: a raw control byte in a source
  // file renders as nothing and is findable by neither spelling.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

interface Run {
  /** stdout ALONE — the machine channel, kept apart so a document can be parsed from it. */
  stdout: string;
  /** stdout and stderr together, for the console face's own lines. */
  output: string;
  status: number | null;
}

/** The CLI, from source, with `--check`'s non-zero exit treated as data. */
function runCli(args: readonly string[]): Run {
  const child = spawnSync(TSX, [CLI, 'i18n', 'extract', ...args], {
    cwd: CLI_PACKAGE_ROOT,
    encoding: 'utf8',
    env: childEnv(),
    timeout: 180_000,
  });
  const stdout = plain(child.stdout ?? '');
  return { stdout, output: `${stdout}${plain(child.stderr ?? '')}`, status: child.status };
}

/**
 * What the MACHINE face said, in one comparable reading.
 *
 * `documents` is the count stdout parses into — 1 for a well-formed run, and
 * the reading that catches the payload-then-error-envelope shape, which is
 * unparseable as one document and would otherwise look like a repair.
 *
 * ⭐ The drift envelope is TWO lines — a sentence and the command that heals
 * it — and both are read, because the second one is where this face can go
 * wrong on its own. Reading only the first line is what let a remedy naming a
 * `--json` run (which emits a payload and writes zero files) sit green: an
 * operator or CI log reader who runs exactly what the failure prints gets
 * nothing written and the identical failure next time. That is the #14895
 * loop — "the failure is self-healable and the advice is what stops it
 * healing" — so the remedy's two load-bearing properties are pinned as their
 * own booleans rather than left to a substring check on line one.
 */
function jsonVerdict(run: Run): {
  status: number | null;
  documents: number;
  /** The `error` sentence's first line, or `null` when the run carried no envelope. */
  error: string | null;
  /** Whether the remedy line names an `--out`, i.e. whether it writes anywhere. */
  remedyNamesOut: boolean;
  /** Whether the remedy line still carries `--json`, which writes nothing. */
  remedyCarriesJson: boolean;
  /** Whether the ordinary extract payload was emitted (its `bundles` member). */
  payload: boolean;
} {
  let parsed: unknown;
  let documents = 0;
  try {
    parsed = JSON.parse(run.stdout);
    documents = 1;
  } catch {
    // Anything that is not exactly one document — none, or two concatenated.
    documents = run.stdout.trim() === '' ? 0 : 2;
  }
  const doc = (parsed ?? {}) as { error?: unknown; bundles?: unknown };
  const lines = typeof doc.error === 'string' ? doc.error.split('\n') : [];
  const remedy = lines[1] ?? '';
  return {
    status: run.status,
    documents,
    error: lines.length > 0 ? (lines[0] as string) : null,
    remedyNamesOut: remedy.includes('--out='),
    remedyCarriesJson: remedy.includes('--json'),
    payload: typeof doc.bundles === 'object' && doc.bundles !== null,
  };
}

/** What the CONSOLE face said — the positive control's own reading. */
function consoleVerdict(run: Run): {
  status: number | null;
  drift: string[];
  drifted: boolean;
  inSync: boolean;
} {
  return {
    status: run.status,
    drift: [...run.output.matchAll(/(missing:|out of date:)\s+(\S+)/g)].map((m) => `${m[1]} ${m[2]}`),
    drifted: run.output.includes(DRIFTED),
    inSync: run.output.includes('in sync with the schema'),
  };
}

/** A private `--out` for one case, optionally seeded from the in-sync tree. */
function outDir(name: string, seeded = false): string {
  const dir = join(outRoot, name);
  if (seeded) cpSync(syncedOut, dir, { recursive: true });
  else mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  const sharedRoot = join(CLI_PACKAGE_ROOT, 'tmp');
  mkdirSync(sharedRoot, { recursive: true });
  fixtureRoot = mkdtempSync(join(sharedRoot, 'os-i18n-16600-fixture-'));
  CONFIG = join(fixtureRoot, 'objectstack.config.ts');
  writeFileSync(CONFIG, STACK_CONFIG, 'utf8');
  outRoot = mkdtempSync(join(tmpdir(), 'os-i18n-16600-'));

  // A real extract, so the "in sync" tree is what the command itself writes
  // rather than bytes this file predicted.
  syncedOut = join(outRoot, 'synced');
  const wrote = runCli([CONFIG, ...FLAGS, `--out=${syncedOut}`]);
  expect({ status: wrote.status, files: readdirSync(syncedOut) }).toEqual({ status: 0, files: [BUNDLE] });
}, 300_000);

afterAll(() => {
  // This suite's own directories only. Never the shared `tmp/` root.
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(outRoot, { recursive: true, force: true });
});

describe('os i18n extract --check --json — compares, and reports what it found (#16600)', () => {
  /**
   * The card's own table: two invocations differing only by `--json` must reach
   * the same exit code, and the `--json` one must say it found DRIFT rather
   * than merely failing.
   *
   * Falsifier: restoring the unconditional `return` in the `--json` branch
   * gives `{ status: 0, documents: 1, error: null, payload: true }` against the
   * control's exit 1 and reported `missing:`.
   */
  it('reports nothing committed with the same exit code as the same run without --json', () => {
    const out = outDir('missing');
    const args = [CONFIG, ...FLAGS, `--out=${out}`, '--check'];

    const control = runCli(args);
    const json = runCli([...args, '--json']);

    // The positive control the card supplies: the drift is really there.
    expect(consoleVerdict(control)).toEqual({
      status: 1,
      drift: [`missing: ${join(out, BUNDLE)}`],
      drifted: true,
      inSync: false,
    });
    // The reading under test — spelled out as well as compared, so two runs
    // that BOTH compare nothing cannot satisfy this by agreeing with each other.
    expect(jsonVerdict(json)).toEqual({
      status: 1,
      documents: 1,
      error: DRIFTED + ' Regenerate and commit:',
      // The remedy has to be a command that actually regenerates: it keeps the
      // `--out` it was given and sheds the `--json` that writes nothing.
      remedyNamesOut: true,
      remedyCarriesJson: false,
      payload: false,
    });
    // The card's acceptance, stated as the equality it is.
    expect(json.status).toBe(control.status);
    // …while writing nothing, which is the half `--check` contributes.
    expect(readdirSync(out)).toEqual([]);
  });

  /**
   * The second drift shape, and the stronger "writes nothing": a committed
   * bundle that is out of date is REPORTED and left byte-for-byte alone.
   */
  it('reports a stale committed bundle without rewriting it', () => {
    const out = outDir('stale', true);
    const bundle = join(out, BUNDLE);
    const stale = `${readFileSync(bundle, 'utf8')}\n// edited by hand\n`;
    writeFileSync(bundle, stale, 'utf8');

    // Spelled out rather than compared against a second control run: the
    // control-vs-json equality is the case above, and naming the expected
    // report is the stronger half of it anyway. One spawn saved.
    expect(jsonVerdict(runCli([CONFIG, ...FLAGS, `--out=${out}`, '--check', '--json']))).toEqual({
      status: 1,
      documents: 1,
      error: DRIFTED + ' Regenerate and commit:',
      remedyNamesOut: true,
      remedyCarriesJson: false,
      payload: false,
    });
    expect(readFileSync(bundle, 'utf8')).toBe(stale);
  });

  /**
   * The direction no unconditional failure can pass: an in-sync tree exits 0 on
   * both faces and the machine one still emits its ordinary payload.
   *
   * ⚠️ Green on BOTH sides of this card's mutation, deliberately — see the file
   * header. Its job is to stop "always fail under `--check --json`" from
   * satisfying every other case here, not to detect the defect.
   */
  it('passes an in-sync tree on both faces, and still emits the payload', () => {
    const out = outDir('in-sync', true);
    const args = [CONFIG, ...FLAGS, `--out=${out}`, '--check'];

    const control = runCli(args);
    const json = runCli([...args, '--json']);

    expect(consoleVerdict(control)).toEqual({ status: 0, drift: [], drifted: false, inSync: true });
    expect(jsonVerdict(json)).toEqual({
      status: 0,
      documents: 1,
      error: null,
      remedyNamesOut: false,
      remedyCarriesJson: false,
      payload: true,
    });
    expect(json.status).toBe(control.status);
    expect(readdirSync(out)).toEqual([BUNDLE]);
  });

  /**
   * The other thing the early return skipped. `--check` with no `--out` has
   * nothing to compare against, and the console face has always refused it;
   * under `--json` the refusal was unreachable, so the run exited 0 with a
   * payload having been asked for a comparison it could not make.
   */
  it('refuses --check with no --out on the machine face too', () => {
    const json = runCli([CONFIG, ...FLAGS, '--check', '--json']);

    expect(json.status).toBe(1);
    const verdict = jsonVerdict(json);
    expect({ documents: verdict.documents, payload: verdict.payload }).toEqual({ documents: 1, payload: false });
    expect(verdict.error).toContain(NEEDS_OUT);
  });

  /**
   * The repair may not be satisfied by turning the machine face into a checker:
   * a `--json` run that did not ask for `--check` still emits the payload and
   * exits 0, on the very tree the case above fails on.
   */
  it('leaves a --json run that did not ask for --check alone', () => {
    const out = outDir('no-check');
    const json = runCli([CONFIG, ...FLAGS, `--out=${out}`, '--json']);

    expect(jsonVerdict(json)).toEqual({
      status: 0,
      documents: 1,
      error: null,
      remedyNamesOut: false,
      remedyCarriesJson: false,
      payload: true,
    });
    // `--json` is "output JSON instead of writing files", so the directory the
    // drift cases found empty is still empty.
    expect(readdirSync(out)).toEqual([]);
  });
  // Every case spawns the CLI through `tsx`; measured at ~4 s per run on a
  // shared box, over vitest's 5 s default once a case spawns twice. Same
  // instrument and the same generous ceiling as the sibling CLI-spawning pins
  // in this directory.
}, 900_000);
