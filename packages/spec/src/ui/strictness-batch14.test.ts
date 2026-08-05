// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4001 批 14 — the ui/ wave's second slice.
 *
 * Eleven strip sites measured, **nine closed and two reclassified**. This file
 * carries both halves, because they are one verdict per schema and the ledger's
 * row is per FILE: `sharing.zod.ts` alone splits, with one live door and one
 * shape nothing parses.
 *
 * Three kinds of assertion live here:
 *
 * 1. **Closure** — each newly-strict shape rejects an undeclared key and the
 *    rejection is USEFUL (names the surface, echoes the key, prescribes).
 * 2. **The split's surviving half** — the importer instrument that told the two
 *    apart, plus the live-carrier pin for `SharingConfigSchema`. This used to be
 *    a pair of no-door pins over `NotificationActionSchema` / `EmbedConfigSchema`
 *    that would go RED if either gained a carrier key; #5015 answered that
 *    verdict as ADR-0049 REMOVE and both shapes are gone, so the absence pins
 *    live in `notification-embed-retirement.test.ts` where they can actually
 *    fail. See the block's own header for why they are not restated here.
 * 3. **Prescription integrity** — was here; now package-wide in
 *    `shared/alias-integrity.test.ts` (#5013), which judges all 235
 *    `strictObject` surfaces against their runtime `.shape` instead of the nine
 *    this batch could hand-map. The six pre-existing defects this file used to
 *    carry as a reverse-pinned debt list are fixed, so the pin fired and was
 *    retired with them. What remains here is the parse-level assertion a
 *    structural gate cannot make.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { ActionParamSchema } from './action.zod';
import { SharingConfigSchema } from './sharing.zod';
import { ReportSortSchema, JoinedReportBlockSchema } from './report.zod';
import { DatasetDimensionSchema, DatasetMeasureSchema } from './dataset.zod';
import { DashboardWidgetSchema } from './dashboard.zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_SRC = path.resolve(HERE, '..');

/** Every unknown-key message produced by parsing `payload` against `schema`. */
function rejectionFor(schema: z.ZodTypeAny, payload: unknown): string {
  const r = schema.safeParse(payload);
  if (r.success) return '';
  return r.error.issues.map((i) => i.message).join('\n');
}

// ---------------------------------------------------------------------------
// 1. Closure — the nine sites this batch tightened
// ---------------------------------------------------------------------------

describe('批 14 — closed shapes reject undeclared keys', () => {
  const widgetBase = {
    id: 'w1',
    dataset: 'sales',
    values: ['revenue'],
  };

  const cases: Array<[string, z.ZodTypeAny, Record<string, unknown>, string]> = [
    [
      'ui/action ActionParamSchema.options[]',
      ActionParamSchema,
      { name: 'p', options: [{ label: 'A', value: 'a', colour: 'red' }] },
      'this action param option',
    ],
    [
      'ui/sharing SharingConfigSchema',
      SharingConfigSchema,
      { enabled: true, anonymous: true },
      'this sharing config',
    ],
    [
      'ui/report ReportSortSchema',
      ReportSortSchema,
      { by: 'revenue', dir: 'desc' },
      'this report order key',
    ],
    [
      'ui/report JoinedReportBlockSchema',
      JoinedReportBlockSchema,
      { name: 'block_a', dataset: 'sales', values: ['revenue'], groupings: ['region'] },
      'this joined report block',
    ],
    [
      'ui/dataset DatasetDimensionSchema',
      DatasetDimensionSchema,
      { name: 'region', field: 'account.region', granularity: 'month' },
      'this dataset dimension',
    ],
    [
      'ui/dataset DatasetMeasureSchema',
      DatasetMeasureSchema,
      { name: 'revenue', aggregate: 'sum', field: 'amount', aggregation: 'sum' },
      'this dataset measure',
    ],
    [
      'ui/dataset DatasetMeasureSchema.derived',
      DatasetMeasureSchema,
      { name: 'rate', derived: { op: 'ratio', of: ['a', 'b'], operands: ['a'] } },
      'this derived-measure spec',
    ],
    [
      'ui/dashboard DashboardWidgetSchema.layout',
      DashboardWidgetSchema,
      { ...widgetBase, layout: { x: 0, y: 0, w: 3, h: 4, minW: 2 } },
      'this widget layout box',
    ],
  ];

  it.each(cases)('%s rejects an undeclared key and names its surface', (_name, schema, payload, surface) => {
    const message = rejectionFor(schema, payload);
    expect(message).toContain('Unrecognized key(s) on');
    expect(message).toContain(surface);
  });

  it('each rejection echoes the offending key back verbatim', () => {
    expect(rejectionFor(SharingConfigSchema, { anonymous: true })).toContain('`anonymous`');
    expect(rejectionFor(ReportSortSchema, { by: 'x', dir: 'desc' })).toContain('`dir`');
    expect(
      rejectionFor(DatasetMeasureSchema, { name: 'm', aggregate: 'sum', field: 'f', aggregation: 'sum' }),
    ).toContain('`aggregation`');
  });
});

// ---------------------------------------------------------------------------
// The curated prescriptions — the entries the batch justified individually
// ---------------------------------------------------------------------------

describe('批 14 — curated prescriptions', () => {
  it('sharing: the camelCase near-misses reach their canonical key', () => {
    // Each of these is out of the edit-distance fallback's reach, because the
    // fallback lower-cases the input but not the candidates (#4990).
    for (const [written, canonical] of [
      ['anonymous', 'allowAnonymous'],
      ['allowGuest', 'allowAnonymous'],
      ['url', 'publicLink'],
      ['slug', 'publicLink'],
      ['domains', 'allowedDomains'],
      ['expires', 'expiresAt'],
      ['isPublic', 'enabled'],
    ] as const) {
      expect(rejectionFor(SharingConfigSchema, { [written]: true })).toContain(
        `\`${written}\` → \`${canonical}\``,
      );
    }
  });

  it('dataset measure: a Cube metric `type` is aimed at `aggregate`, not read as a datatype', () => {
    // The dangerous overlap: on a Cube metric `type` IS the aggregation, and on
    // a dataset DIMENSION `type` is the datatype. Before this batch, writing
    // `type: 'sum'` on a measure parsed clean and computed something else.
    const message = rejectionFor(DatasetMeasureSchema, { name: 'revenue', field: 'amount', type: 'sum' });
    expect(message).toContain('`type` → `aggregate`');
  });

  it('dataset: `sql` gets a prescription, never a rename', () => {
    // Aliasing `sql` to `field` would hand `SUM(amount)` to a slot that takes a
    // field PATH — ledger finding 7's shape. It must arrive as guidance.
    for (const schema of [DatasetDimensionSchema, DatasetMeasureSchema]) {
      const message = rejectionFor(schema, { name: 'x', field: 'f', aggregate: 'sum', sql: 'SUM(amount)' });
      expect(message).toContain('takes no raw SQL');
      expect(message).not.toContain('`sql` → ');
    }
  });

  it('dashboard: RGL constraint keys are prescribed, not renamed onto a position key', () => {
    const message = rejectionFor(DashboardWidgetSchema, {
      id: 'w1', dataset: 'd', values: ['v'],
      layout: { x: 0, y: 0, w: 3, h: 4, minW: 2, static: true },
    });
    expect(message).toContain('React-Grid-Layout');
    expect(message).not.toContain('`minW` → ');
    expect(message).not.toContain('`static` → ');
  });

  /**
   * `compareTo` was a UNION when this batch closed its object arm, and that
   * changed what a rejection was worth — a fact 批 14 measured rather than
   * assumed, after writing the assertion the obvious way and watching it go red
   * on `'Invalid input'`. Zod collapses a failed union into ONE top-level
   * `invalid_union` issue whose message is the bare `'Invalid input'`; the arm
   * errors — including the curated prescription — live in `issue.errors`, and
   * `zodIssuesToFields` (`rest/src/rest-server.ts`) maps only top-level issues,
   * so nothing carried them onto the wire (#5014).
   *
   * ⚠️ #5011 DISSOLVED that limit for this slot, and the correction is recorded
   * here rather than by deleting the finding: `compareTo` is no longer a union
   * at all. It converged onto the analytics executor's own contract,
   * `{ kind, dimension? }` — a plain strict object — because the three arms it
   * declared were all broken on the ADR-0021 dataset path (two silently dropped,
   * `{ offset }` throwing). The batch's measurement stands as the reason the
   * union-free shape is worth something; #5014 still binds every OTHER curated
   * message this campaign has put inside a union arm.
   *
   * What survives here is the pin that keeps the correction honest: this slot
   * must not become a union again. The converged behaviour itself
   * (prescriptions, aliases, the executor projection) is pinned in
   * `dashboard-compareto.test.ts`.
   */
  it('dashboard compareTo: no longer a union — the #4001 arm-error limit does not apply to it (#5011)', () => {
    const r = DashboardWidgetSchema.safeParse({
      id: 'w1', dataset: 'sales', values: ['revenue'],
      compareTo: { offset: '7d', granularity: 'month' },
    });
    expect(r.success).toBe(false);
    const issues = r.success ? [] : r.error.issues;
    expect(issues.some((i) => i.code === 'invalid_union'),
      'a union here would put the prescription back out of reach').toBe(false);
    // …and the prescription really is at the top level now, which is exactly
    // what 批 14 could assert only about the arm errors.
    const top = issues.map((i) => i.message).join('\n');
    expect(top).not.toBe('Invalid input');
    expect(top).toContain('this comparison window');
  });

  it('action option: guidance separates keys that exist one layer down from keys that exist nowhere', () => {
    const declaredOneLayerDown = rejectionFor(ActionParamSchema, {
      name: 'p', options: [{ label: 'A', value: 'a', color: 'red' }],
    });
    expect(declaredOneLayerDown).toContain('SelectOptionSchema');

    const nowhere = rejectionFor(ActionParamSchema, {
      name: 'p', options: [{ label: 'A', value: 'a', icon: 'x' }],
    });
    // `icon` is NOT on SelectOptionSchema — claiming it were is the false
    // prescription class (ledger finding 18).
    expect(nowhere).toContain('no option shape in the spec declares `icon`');
    expect(nowhere).not.toContain('is a per-option key of a FIELD');
  });

  it('guidance emits one bullet per offending key, not one shared sentence repeated', () => {
    const message = rejectionFor(ActionParamSchema, {
      name: 'p', options: [{ label: 'A', value: 'a', icon: 'x', disabled: true }],
    });
    expect(message).toContain('`icon`');
    expect(message).toContain('`disabled`');
  });
});

// ---------------------------------------------------------------------------
// 3. Prescription integrity — SUPERSEDED by the package-wide gate (#5013)
// ---------------------------------------------------------------------------

/**
 * This section used to carry two assertions and a debt list: that every alias
 * target 批 14 added is a key the schema declares, and a reverse pin naming the
 * six pre-existing defects in these files that the batch did not own
 * (`ReportSchema`'s `filter`/`columns`/`chart`, `DatasetSchema`'s
 * `measures`/`filter`, `ActionSchema`'s `body`).
 *
 * Both are gone because both were kept honest: #5013 fixed all six, so the
 * reverse pin fired exactly as its comment promised — *"this list cannot
 * outlive its debt"* — and the verdict itself now runs package-wide in
 * `shared/alias-integrity.test.ts`, over all 235 `strictObject` surfaces rather
 * than the nine this batch hand-mapped.
 *
 * It is deleted rather than emptied, because what would be left is a second,
 * WEAKER copy of a live check: the version here read alias tables from the
 * source with the TypeScript AST and bound each `surface` string to a schema by
 * hand, which cannot see through a shape's spreads, reads the ten
 * dynamically-assembled tables as empty, and mis-binds `'this field group'`
 * (two schemas share that string). Keeping it would reintroduce exactly the
 * two-copies-of-the-truth problem `strictObject` exists to collapse.
 *
 * The one assertion NOT subsumed stays: a structural gate proves a prescribed
 * key is declared, never that the shape it prescribes actually parses.
 */
describe('批 14 — the prescribed action param option shape really parses', () => {
  it('the action param option shape accepts exactly the pair it prescribes', () => {
    const r = ActionParamSchema.safeParse({ name: 'p', options: [{ label: 'A', value: 'a' }] });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. No-door pins — RED the day either shape gains a carrier key
// ---------------------------------------------------------------------------

/**
 * Every `.ts` module under `packages/spec/src`, excluding tests.
 */
function specModules(dir = SPEC_SRC, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) specModules(p, out);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(p);
  }
  return out;
}

/**
 * Modules that import the module at `targetRel` (spec-src-relative, no
 * extension), as a sorted list of spec-src-relative paths.
 *
 * Two properties this needs, and the first draft had neither — both found by
 * running the pin before believing it:
 *
 * - **All three import forms.** A matcher that knows only `import … from '…'`
 *   misses the barrel's `export * from '…'` and a bare side-effect `import '…'`,
 *   and would land as a partly-hollow green. (批 13 hit the identical gap.)
 * - **Specifier RESOLUTION, not substring matching.** This repo has TWO
 *   `sharing.zod` modules — `ui/sharing.zod` and `security/sharing.zod` — so a
 *   substring test credits `stack.zod.ts` and `security/index.ts` with
 *   importing the UI one. Every specifier is therefore resolved against its
 *   importer's own directory before comparing.
 */
function importersOf(targetRel: string): string[] {
  const target = path.resolve(SPEC_SRC, targetRel);
  const SPECIFIER =
    /(?:^|\n)\s*(?:import\s[\s\S]*?from\s*|export\s[\s\S]*?from\s*|import\s*)['"]([^'"]+)['"]/g;
  const out: string[] = [];
  for (const file of specModules()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      if (!specifier.startsWith('.')) continue;
      if (path.resolve(path.dirname(file), specifier) !== target) continue;
      out.push(path.relative(SPEC_SRC, file).split(path.sep).join('/'));
      break;
    }
  }
  return out.sort();
}

describe('批 14 — the file that split, after #5015 retired its dead half', () => {
  // ── What this block is now, and why it is not just deleted ────────────────
  //
  // 批 14 measured eleven strip sites and reclassified two — `NotificationAction`
  // and `EmbedConfig` — as `no door`, pinning them here so the verdict would go
  // RED if either ever gained a carrier key. #5015 answered that verdict the
  // other way: ADR-0049 enforce-or-remove, ruled REMOVE, and both shapes are
  // gone.
  //
  // Their ABSENCE pins moved to `notification-embed-retirement.test.ts`, which
  // asserts it by resolved symbol identity across every public entry. They are
  // deliberately NOT restated here as `expect(names).toEqual([])`: with the
  // schemas deleted, such an assertion passes because nothing is produced rather
  // than because the logic holds — a pin that cannot fail is worse than none,
  // since it reads as coverage (the trap PR #5046 documented).
  //
  // What survives here is the half that is still about a LIVE shape: the
  // instrument that told the two apart in the first place, and the carrier pin
  // for `SharingConfigSchema`. That carrier is the whole reason this file was
  // the ledger's first one-row-two-verdicts case, so losing it with the dead
  // half would delete the evidence for the surviving verdict.

  it('the importer pin sees all three import forms and does not confuse same-named modules', () => {
    // Self-test first: an assertion about "who imports X" is worthless if the
    // matcher only knows one spelling. `ui/i18n.zod` is imported with
    // `import … from` by several ui modules AND re-exported by the barrel with
    // `export * from`.
    const i18n = importersOf('ui/i18n.zod');
    expect(i18n).toContain('ui/index.ts');   // export * from
    expect(i18n).toContain('ui/view.zod.ts'); // import … from
    expect(i18n.length).toBeGreaterThan(2);

    // And the discriminating case: two `sharing.zod` modules exist. Resolution,
    // not substring matching, is what keeps them apart — a substring test
    // miscredits `stack.zod.ts` and `security/index.ts` to the UI module.
    expect(importersOf('security/sharing.zod')).toContain('stack.zod.ts');
    expect(importersOf('ui/sharing.zod')).not.toContain('stack.zod.ts');
  });

  it('SharingConfig keeps the live carrier that made this file split (#5015 took the other half)', () => {
    // The carrier is specific, and that asymmetry IS the 批 14 reclassification:
    // the form view names `SharingConfigSchema`. `EmbedConfigSchema` was named by
    // nothing, which is what #5015 acted on.
    expect(importersOf('ui/sharing.zod')).toEqual(['ui/index.ts', 'ui/view.zod.ts']);
    expect(fs.readFileSync(path.join(SPEC_SRC, 'ui/view.zod.ts'), 'utf8'))
      .toContain('SharingConfigSchema');
  });

  it('the surviving door is still CLOSED — the retirement did not relax 批 14', () => {
    // The one assertion in this block that exercises behaviour rather than
    // topology. `SharingConfigSchema` was tightened by 批 14 and must stay
    // tightened: removing its dead sibling from the same file is exactly the
    // kind of edit that could take the strictness with it.
    const rejected = SharingConfigSchema.safeParse({ enabled: true, bogus: 1 });
    expect(rejected.success).toBe(false);
    // Positive control in the same run: a declared key still parses, so the
    // rejection above is about `bogus` and not about the shape being broken.
    expect(SharingConfigSchema.safeParse({ enabled: true, allowAnonymous: true }).success)
      .toBe(true);
  });

  it('both modules record the retirement where the next reader will look', () => {
    const notification = fs.readFileSync(path.join(SPEC_SRC, 'ui/notification.zod.ts'), 'utf8');
    const sharing = fs.readFileSync(path.join(SPEC_SRC, 'ui/sharing.zod.ts'), 'utf8');
    for (const source of [notification, sharing]) {
      expect(source).toContain('#5015');
      expect(source).toContain('ADR-0049');
    }
    // The surviving module still explains its own live door, so a later reader
    // does not mistake the whole file for retired surface.
    expect(sharing).toContain('live authoring door');
  });
});
