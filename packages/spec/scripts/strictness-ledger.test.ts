// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression cover for the #4001 strictness-ledger gate's coverage walk.
 *
 * The gate protects the ledger from going stale. Nothing protected the gate,
 * and it shipped with a one-level-deep directory listing that hid
 * `data/driver/` — nine authorable sites — while reporting "no undeclared
 * schema files". The failure was invisible for the same reason the silent key
 * strip this whole campaign is about is invisible: a success signal covering an
 * omission.
 *
 * So these tests assert the gate can see the thing it once could not, rather
 * than only that it passes today. A green check that has never been shown to go
 * red proves nothing.
 *
 * MEASURED, and the reason this file is not redundant with the gate: with the
 * `data/driver/` rows now present in the ledger, reverting the walk to
 * non-recursive leaves `check:strictness-ledger` **passing** — a one-level walk
 * finds nothing missing once nothing nested is missing. The gate cannot detect
 * its own regression. These tests can, and did (`descends into subdirectories`
 * is the one that fails). Deleting them silently restores the blind spot.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { describe, expect, it } from 'vitest';

import { analyzeSites, countSites, countStripSites, listSchemaFiles } from './lib/strictness-ledger';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const SRC = path.join(SPEC, 'src');
const LEDGER = path.resolve(SPEC, '../../docs/audits/2026-07-unknown-key-strictness-ledger.md');

/** Absolute path of a source file, relative to `packages/spec/src`. */
const at = (rel: string) => path.join(SRC, rel);

/** The directories the ledger triages file-by-file. */
const TRIAGED = ['ui', 'data', 'automation', 'security', 'studio'] as const;

describe('strictness-ledger coverage walk', () => {
  it('descends into subdirectories', () => {
    const files = listSchemaFiles(path.join(SRC, 'data'));

    // The exact surface the non-recursive walk hid. If this ever fails because
    // the files moved, re-point it at whatever nested schema exists — do not
    // delete it, or the blind spot comes back unobserved.
    expect(files).toContain('driver/postgres.zod.ts');
    expect(files).toContain('driver/mongo.zod.ts');
    expect(files).toContain('driver/memory.zod.ts');
  });

  it('returns paths relative to the directory, as the ledger declares them', () => {
    for (const file of listSchemaFiles(path.join(SRC, 'data'))) {
      expect(file.startsWith('/')).toBe(false);
      expect(file).not.toContain('\\');
    }
  });

  it.each(TRIAGED)('declares every sited schema file under %s/', (dir) => {
    const ledger = fs.readFileSync(LEDGER, 'utf-8');
    const dirPath = path.join(SRC, dir);

    const undeclared = listSchemaFiles(dirPath)
      .filter((f) => countSites(path.join(dirPath, f)) > 0)
      // Backticked exactly as the triage tables write it.
      .filter((f) => !ledger.includes(`\`${f}\``));

    // A second, independent statement of the gate's coverage rule — deliberately
    // not sharing the gate's table parser, so a bug in that parser cannot make
    // both agree on a wrong answer.
    expect(undeclared).toEqual([]);
  });
});

/**
 * The site counter's own regression cover.
 *
 * Written after the #4001 re-measurement found the previous, textual counter
 * wrong in both directions at once — counting `z.object({…})` that appeared in
 * JSDoc prose, and missing both the prettier-wrapped `z\n  .object({` form and
 * `z.looseObject(`. On `ui/` the two errors happened to cancel, so the section
 * header was correct over two wrong rows.
 *
 * Every case below names a REAL site that the old counter got wrong, so the test
 * is a red-on-known-input check rather than a restatement of current output.
 */
describe('site counting reads the AST, not the source text', () => {
  it('does not count a z.object( that appears inside a comment', () => {
    // Both "sites" the old regex found here are inside one JSDoc example.
    expect(countSites(at('kernel/metadata-protection.zod.ts'))).toBe(0);
    expect(countSites(at('shared/suggestions.zod.ts'))).toBe(0);
    // And the case that mattered, because this file IS triaged: 9 → 8.
    expect(countSites(at('ui/action.zod.ts'))).toBe(8);
  });

  it('counts a call the source wraps across lines (`z\\n  .object({`)', () => {
    // ChartAggregateSchema is written wrapped; the old `z\.object\(` missed it.
    // 7 → 8 at #5022, which ADDED `ChartDrillDownSchema` (a strictObject site).
    // The count is incidental to what this case actually pins — that a wrapped
    // call is seen at all — so the assertion that carries the meaning is the
    // one below it, not this number.
    const chart = analyzeSites(at('ui/chart.zod.ts'));
    expect(chart).toHaveLength(8);
    expect(chart.map((s) => s.name)).toContain('ChartAggregateSchema');

    // The one that was hidden ENTIRELY: a wrapped call was this file's only
    // site, so it counted zero — and a zero-site file is skipped by the coverage
    // walk, which is how an authorable schema stayed out of the ledger while the
    // gate reported "no undeclared schema files".
    const trigger = analyzeSites(at('automation/time-relative-trigger.zod.ts'));
    expect(trigger).toHaveLength(1);
    expect(trigger[0].name).toBe('TimeRelativeTriggerSchema');
  });

  it('knows every object idiom, including z.looseObject(', () => {
    const fv = analyzeSites(at('data/field-value.zod.ts'));
    expect(fv).toHaveLength(2);
    expect(fv.find((s) => s.name === 'FileValueSchema')?.idiom).toBe('z.looseObject');
  });
});

/**
 * Posture reading — the property that makes a remaining-work map possible at
 * all. The gate could previously only ask "does this FILE contain any
 * `.strict()`", which is why the campaign was still planning off counts of
 * `strictObject(` occurrences: that idiom misses every schema closed with the
 * OLDER `z.object(…).strict()` spelling, and reads `automation/` as 0 strict
 * when it has 8.
 *
 * Each case pairs a real reading with a MUTATED copy of the same file, so the
 * reading is shown to flip. A posture check that has only ever been seen green
 * is the exact instrument this campaign keeps getting burned by.
 */
describe('posture reading, with a red control for each', () => {
  /** Analyze a mutated copy of a real source file. */
  const mutate = (rel: string, from: string, to: string) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf-8');
    expect(src, `mutation anchor missing in ${rel}`).toContain(from);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strictness-'));
    const tmp = path.join(dir, path.basename(rel));
    fs.writeFileSync(tmp, src.replace(from, to));
    try {
      return analyzeSites(tmp, rel);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('reads the strictObject( helper as strict — and as strip once un-converted', () => {
    const rel = 'ui/action.zod.ts';
    const live = analyzeSites(at(rel)).find((s) => s.name === 'ActionAiSchema');
    expect(live?.posture).toBe('strict');
    expect(live?.idiom).toBe('strictObject');

    const red = mutate(rel, 'export const ActionAiSchema = strictObject({',
      'export const ActionAiSchema = z.object({').find((s) => s.name === 'ActionAiSchema');
    expect(red?.posture).toBe('strip');
  });

  it('reads the OLDER z.object(…).strict() spelling as strict too', () => {
    // The reading the `strictObject(`-only count could not make.
    //
    // The fixture used to be `security/permission.zod.ts`, whose four sites
    // were the campaign's canonical `z.object(shape, { error }).strict()`
    // wiring; #5593 migrated all four to `strictObject`, so the file no longer
    // exercised the branch under test, and the fixture moved to
    // `TenancyConfigSchema` — until #6619 folded ITS hand-written map into the
    // shared template. It then moved to `ObjectCapabilities`, same file, on the
    // reading that its map (`strictCapabilitiesError`) emitted NO trailing
    // history sentence and so could not fold. **#6805 disproved that reading**:
    // the missing sentence was a gap in the TEXT, not a limit of the template
    // (`history` encodes position, and `enable` had a real history nobody had
    // written down), so that site is `strictObject` too now.
    //
    // `PerOperationRequiredPermissionsSchema`, still the same file, is the
    // spelling's carrier today — and a more durable one, because it carries no
    // guidance table at all and therefore nothing pulls it toward the helper.
    // If it is ever converted, move this fixture AGAIN rather than deleting the
    // assertion: the AST reader still has to make the reading, and
    // `packages/spec` is not the only tree it reads.
    const objectSites = analyzeSites(at('data/object.zod.ts'));
    const perOperation = objectSites.find((s) => s.name === 'PerOperationRequiredPermissionsSchema');
    expect(perOperation?.posture, 'a plain `.strict()` chain is still strict').toBe('strict');
    expect(perOperation?.idiom).toBe('z.object');

    // …and the two sites the fixture vacated read as the helper now, which is
    // the control that keeps the line above a statement about the READER
    // rather than about one lucky survivor. Without it, a reader that simply
    // stopped distinguishing idioms would still satisfy the assertion.
    for (const name of ['ObjectCapabilities', 'TenancyConfigSchema']) {
      const folded = objectSites.find((s) => s.name === name);
      expect(folded, `${name} is not a site any more — re-point this test, do not delete it`).toBeDefined();
      expect(folded?.idiom, `${name} folded into the helper at #6619/#6805`).toBe('strictObject');
      expect(folded?.posture).toBe('strict');
    }

    // The permission file's four are now the helper, and still strict — the
    // control that keeps this test a statement about the READER rather than
    // about one file.
    const perm = analyzeSites(at('security/permission.zod.ts'));
    expect(perm.filter((s) => s.posture === 'strict')).toHaveLength(4);
    expect(perm.find((s) => s.name === 'PermissionSetSchema')?.idiom).toBe('strictObject');
    expect(countStripSites(at('security/permission.zod.ts'))).toBe(0);
  });

  it('reads a default site as strip — and as strict once closed', () => {
    const rel = 'automation/execution.zod.ts';
    const live = analyzeSites(at(rel)).find((s) => s.name === 'ExecutionStepLogSchema');
    expect(live?.posture).toBe('strip');

    const red = mutate(rel, 'export const ExecutionStepLogSchema = lazySchema(() => z.object({',
      'export const ExecutionStepLogSchema = lazySchema(() => z.object({}).strict().extend({')
      .find((s) => s.name === 'ExecutionStepLogSchema');
    expect(red?.posture).toBe('strict');
  });

  it('reads .passthrough() as passthrough, not as closed', () => {
    // The deliberate renderer escape hatch. If this ever read as `strict` the
    // remaining-work map would under-report, which is the failure direction that
    // retires a reader's suspicion.
    const dash = analyzeSites(at('ui/dashboard.zod.ts'));
    expect(dash.filter((s) => s.posture === 'passthrough')).toHaveLength(1);
  });

  /**
   * #5072. `postureOf` short-circuited on the campaign's OWN helper: it returned
   * `strict` for `strictObject(` before looking at the chain, so
   * `strictObject(…).passthrough()` — open at runtime, deliberately — was drawn on
   * the map as closed. Only `z.object(` ever walked the chain.
   *
   * The two real sites are the anchors here, because the point is not "the parser
   * handles a chain" but "the map stopped lying about these two". Each is paired
   * with the plain-helper control in the same file, so the two readings must
   * differ — a test that only asserted `passthrough` would still pass if the
   * reader started calling everything passthrough.
   */
  it('does not stop at the strictObject( idiom — .passthrough() on it wins (#5072)', () => {
    const view = analyzeSites(at('ui/view.zod.ts'));

    for (const name of ['GanttConfigSchema', 'TreeConfigSchema']) {
      const site = view.find((s) => s.name === name);
      expect(site, `${name} is not a site any more — re-point this test, do not delete it`).toBeDefined();
      // The idiom is still the helper; only the READING of the chain changed.
      expect(site?.idiom).toBe('strictObject');
      expect(site?.posture, `${name} must read as passthrough — it is open at runtime`).toBe('passthrough');
    }

    // The control, in the same file and the same idiom: a bare `strictObject(`
    // with nothing chained on is still strict. Without this the assertion above
    // is satisfied by a reader that has simply stopped distinguishing.
    const plain = view.find((s) => s.name === 'GanttQuickFilterSchema');
    expect(plain?.idiom).toBe('strictObject');
    expect(plain?.posture).toBe('strict');

    // Exactly two, and exactly these two. Pinned as a SET rather than a count so
    // a future batch adding a deliberate `.passthrough()` has to come through
    // here and say so, instead of quietly widening a number.
    expect(view.filter((s) => s.posture === 'passthrough').map((s) => s.name)).toEqual([
      'GanttConfigSchema',
      'TreeConfigSchema',
    ]);

    // And the claim the ledger rests on: no STRIP site moved. Both postures
    // involved are non-strip, so the remaining-strip map — the thing every batch
    // is planned against — is untouched by this fix.
    //
    // The number itself tracks real batches: 6 when #5072 was written, 5 since
    // #5073 closed `UserFiltersSchema`, 3 since #5074. It is the file's live
    // strip count, not a #5072 invariant — what #5072 pins is that ITS OWN
    // change moved no strip site, and that still reads correctly against
    // whatever the current count is.
    //
    // 5 → 3 at #5074, and the arithmetic is worth spelling out because it is
    // not "two more closed": FOUR closed (both `ViewItemSchema` arms, the
    // `ListView.sort` entry, `ViewFilterRuleSchema`) and TWO were ADDED — the
    // two arms of `ViewItemWireSchema`, which are strip BY DESIGN and are the
    // declared home the wire contract moved into. A strip site that exists on
    // purpose still counts here; this map measures posture, not intent, which
    // is exactly why the ledger row carries the intent in prose.
    expect(countStripSites(at('ui/view.zod.ts'))).toBe(3);
  });

  it('lets a chained posture override the idiom in either direction (#5072)', () => {
    // Synthetic, because the repo has no `.strict()` on a loose object and no
    // `z.looseObject(` under a triaged directory — the early return for
    // `z.looseObject` was the same defect waiting for its first instance, so it
    // is covered before that instance exists rather than after.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strictness-idiom-'));
    const file = path.join(dir, 'synthetic.zod.ts');
    fs.writeFileSync(
      file,
      [
        'export const A = strictObject({ a: 1 }).passthrough();',
        'export const B = strictObject({ b: 1 });',
        'export const C = z.looseObject({ c: 1 }).strict();',
        'export const D = z.looseObject({ d: 1 });',
        'export const E = z.strictObject({ e: 1 }).catchall(z.unknown());',
        // Last explicit call wins, not the first.
        'export const F = strictObject({ f: 1 }).passthrough().strict();',
      ].join('\n'),
    );
    try {
      const posture = Object.fromEntries(analyzeSites(file).map((s) => [s.name, s.posture]));
      expect(posture).toEqual({
        A: 'passthrough',
        B: 'strict',
        C: 'strict',
        D: 'passthrough',
        E: 'catchall',
        F: 'strict',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
