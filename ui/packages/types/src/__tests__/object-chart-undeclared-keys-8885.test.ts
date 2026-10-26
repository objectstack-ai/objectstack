/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8885 — `drillDown`, `title` and `compareTo` are declared on BOTH
 * published copies of `ObjectChartSchema` (the TS interface in `../objectql.ts`
 * and the zod mirror in `../zod/objectql.zod.ts`), each bound to the
 * `@objectstack/spec` symbol that already owns it.
 *
 * ## The class
 *
 * objectui#6914: a key read behind a cast and declared on neither published
 * face. `ObjectChart.tsx` read all three off `schema` while both faces stayed
 * silent, so they rode `BaseSchema`'s `[key: string]: any` / `.passthrough()`
 * and arrived UNVALIDATED. `drillDown` was the sharpest instance — this
 * component's registry `inputs` advertise it to the designer palette AND
 * `@objectstack/spec` publishes `ChartDrillDownSchema` for exactly this
 * carrier, so an author was offered a key that neither published shape
 * mentioned.
 *
 * ## Why each binds to the spec rather than to a local type
 *
 * `../objectql.ts` states the rule it inherits: "Never Redefine Types. ALWAYS
 * import them." A hand-written near-copy is what `check:spec-symbols` exists to
 * stop, and the measured cost is not hypothetical — a local rule that looks
 * equivalent to a spec symbol can disagree with it in BOTH directions at once.
 * So:
 *
 *   - `drillDown` → the spec's `ChartDrillDownSchema` / `ChartDrillDown`, whose
 *     own doc names `<ObjectChart drillDown={…}>` as its carrier. ⛔ NOT this
 *     repo's wider `DrillDownConfig`: that one also carries `mode` and `report`
 *     for the table / pivot / metric widgets, and `ObjectChart.tsx` reads
 *     NEITHER — declaring them would advertise two keys accepted and then
 *     dropped.
 *   - `title` → `I18nLabel`, the union `ChartConfigSchema.title` carries and
 *     that `plugin-charts`' `normalizeChartSchema` already resolves through its
 *     `label()` helper (plain string OR inline locale map). The spec's
 *     `REACT_BLOCKS` entry for `ObjectChart` lists `title` among its
 *     `dataProps`, so this is a key the platform's authoring surface offers.
 *   - `compareTo` → `DashboardWidgetSchema.shape.compareTo` BY REFERENCE:
 *     `DashboardRenderer` composes the node with `compareTo: widget.compareTo`,
 *     forwarding the widget key verbatim, so producer and consumer are bound to
 *     one declaration instead of two dialects.
 *
 * ## The ceiling, stated rather than assumed (objectui#5155)
 *
 * `BaseSchema` is `.passthrough()` and its TS twin carried `[key: string]: any`
 * until objectui#8347, so declaring a key bought it its declared TYPE —
 * `title: 42` is refused now — but did NOT buy rejection of a MISSPELLING:
 * `drillDwn: {}` still parsed and still compiled, exactly as `visibleWhn` did on
 * `ObjectGallerySchema` (objectui#6576). It still parses (the mirror is
 * unchanged); since objectui#8347 it no longer compiles, and the counter-probe
 * below is flipped to pin that.
 *
 * ## Four keys stay ledgered, and the ledger is not a waiver
 *
 * `xAxisKey`, `series`, `aggregate` and `filter` are read by the same file and
 * are objectui#7946's remit (PR #8884), not this card's. They are listed BY
 * NAME in {@link LEDGERED_OTHER_CARD_READS}, and every entry carries an
 * assertion that it is STILL READ — a stale exception is a hole. The ledger
 * deliberately does NOT assert that they stay undeclared, so this pin holds
 * whether or not that card has landed; what keeps it from rotting into a wider
 * equation is the independent pair of assertions below (every read key is
 * declared-or-ledgered, AND every key this card declared is still read).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ChartDrillDown, I18nLabel, DashboardWidget as SpecDashboardWidget } from '@objectstack/spec/ui';
import type { ObjectChartSchema } from '../objectql.js';
import { ObjectChartSchema as ObjectChartMirror } from '../zod/objectql.zod.js';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const WIDGET_FILE = 'packages/plugin-charts/src/ObjectChart.tsx';

/** The three keys objectui#8885 ruled on. */
const DECLARED_BY_THIS_CARD = ['drillDown', 'title', 'compareTo'] as const;

/**
 * Keys read off `schema` in `ObjectChart.tsx` that this card deliberately does
 * NOT rule on — objectui#7946's four (PR #8884). Every entry must still be
 * READ; see the file header for why the ledger asserts that and nothing else.
 */
const LEDGERED_OTHER_CARD_READS = ['xAxisKey', 'series', 'aggregate', 'filter'] as const;

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `Equal`, not `extends`: through `BaseSchema`'s index signature an UNDECLARED
 * member read `any` (until objectui#8347), and a one-way check accepts `any` on both sides — which
 * is precisely the before-state this card removed (the objectui#7087
 * disabled-twin lesson).
 */
export type assertionDrillDownIsSpecType = Expect<Equal<ObjectChartSchema['drillDown'], ChartDrillDown | undefined>>;
export type assertionTitleIsSpecI18nLabel = Expect<Equal<ObjectChartSchema['title'], I18nLabel | undefined>>;
export type assertionCompareToIsWidgetKey = Expect<Equal<ObjectChartSchema['compareTo'], SpecDashboardWidget['compareTo']>>;
/** The helper can FAIL — synthetic control (an undeclared key reads `any`). */
export type assertionEqualCanFail = Expect<Equal<Equal<any, ChartDrillDown | undefined>, false>>;

describe('ObjectChartSchema — compile-time pins for the three keys (objectui#8885)', () => {
  it('accepts the spec vocabulary on all three, contextually typed with no cast', () => {
    const schema: ObjectChartSchema = {
      type: 'object-chart',
      chartType: 'bar',
      objectName: 'opportunity',
      drillDown: { enabled: true, target: 'navigate', columns: ['name', 'amount'], maxRows: 50 },
      title: 'Revenue by stage',
      compareTo: { kind: 'previousYear' },
    };
    expect(schema.drillDown?.target).toBe('navigate');
    expect(schema.compareTo?.kind).toBe('previousYear');
  });

  it('accepts the inline-locale-map arm of `title` — the arm `label()` resolves', () => {
    const schema: ObjectChartSchema = {
      type: 'object-chart',
      chartType: 'bar',
      title: { en: 'Revenue by stage', 'zh-CN': '按阶段的收入' },
    };
    expect(schema.title).toMatchObject({ en: 'Revenue by stage' });
  });

  it('refuses a wrong-typed value on each of the three — the check `.passthrough()` was skipping', () => {
    // Each directive fails the build (TS2578) the moment the member stops
    // being declared, so these are the pins that go red if a key is lost.

    // @ts-expect-error — `title` is `I18nLabel`, not a number.
    const badTitle: ObjectChartSchema = { type: 'object-chart', chartType: 'bar', title: 42 };
    // @ts-expect-error — `'popover'` is not an arm of `ChartDrillDown['target']`.
    const badTarget: ObjectChartSchema = { type: 'object-chart', chartType: 'bar', drillDown: { target: 'popover' } };
    // @ts-expect-error — `kind` is the converged two-arm enum, and it is REQUIRED.
    const badKind: ObjectChartSchema = { type: 'object-chart', chartType: 'bar', compareTo: { kind: 'lastWeek' } };

    expect([badTitle.title, badTarget.drillDown, badKind.compareTo]).toHaveLength(3);
  });

  it('refuses the table/pivot keys on a chart drill — `mode` and `report` are NOT read here', () => {
    // The measured reason `ChartDrillDown` is the binding rather than this
    // repo's wider `DrillDownConfig`: those two keys reach no read site in
    // `ObjectChart.tsx`, so declaring them would be authoring bait.

    // @ts-expect-error — `mode` belongs to the table / list widgets' drill.
    const withMode: ObjectChartSchema = { type: 'object-chart', chartType: 'bar', drillDown: { enabled: true, mode: 'record' } };
    expect(withMode.drillDown).toBeTruthy();
  });

  it('the ceiling is gone: a MISSPELLING stops compiling, since objectui#8347 removed `BaseSchema`\'s index signature', () => {
    // This row pinned the honest bound of what declaring a key bought while the
    // signature stood ("revisit deliberately when objectui#5155 lands"). The
    // removal landed as objectui#8347, and the row flipped with it.
    // @ts-expect-error — `drillDwn` is no member of `ObjectChartSchema`; the key is `drillDown`
    const typo: ObjectChartSchema = { type: 'object-chart', chartType: 'bar', drillDwn: { enabled: true } };
    expect(typo.type).toBe('object-chart');
  });
});

/* ── Mirror parity, per key ────────────────────────────────────────────────── */

describe('the zod mirror declares the same three keys (objectui#8885)', () => {
  it.each(DECLARED_BY_THIS_CARD)('the mirror declares `%s`', (key) => {
    expect(Object.keys(ObjectChartMirror.shape)).toContain(key);
  });

  it('the mirror CHECKS the declared values, not just their presence', () => {
    // Non-vacuity for the three `.toContain` assertions above: a key declared
    // as `z.any()` would satisfy them and validate nothing.
    const base = { type: 'object-chart', chartType: 'bar' } as const;

    expect(ObjectChartMirror.safeParse({
      ...base,
      drillDown: { enabled: true, target: 'navigate', columns: ['name'], maxRows: 50 },
      title: 'Revenue by stage',
      compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
    }).success).toBe(true);

    // The inline-locale-map arm of `title`, which `label()` resolves.
    expect(ObjectChartMirror.safeParse({ ...base, title: { en: 'Revenue', 'zh-CN': '收入' } }).success).toBe(true);

    // One refusal per key, each on the VALUE rather than on the key name.
    expect(ObjectChartMirror.safeParse({ ...base, title: 42 }).success).toBe(false);
    expect(ObjectChartMirror.safeParse({ ...base, drillDown: { target: 'popover' } }).success).toBe(false);
    expect(ObjectChartMirror.safeParse({ ...base, drillDown: { maxRows: 'lots' } }).success).toBe(false);
    expect(ObjectChartMirror.safeParse({ ...base, compareTo: { kind: 'lastWeek' } }).success).toBe(false);
    expect(ObjectChartMirror.safeParse({ ...base, compareTo: { dimension: 'close_date' } }).success).toBe(false);
  });

  it('the drill mirror is the spec\'s CHART subset — `mode` / `report` are refused BY NAME', () => {
    // `ChartDrillDownSchema` is `$strict`, which is what makes this a refusal
    // rather than a silent strip. The wider `DrillDownConfigSchema`
    // (`data-display.zod.ts`) is a different widget's contract and would accept
    // both keys — so this is the assertion that fails if the binding is ever
    // re-pointed at it.
    // `report` as the dataset-bound report the wider type declares (its `{ name }` arm is
    // retired, objectui#11517), so the refusal is of the member and not of its value.
    const report = { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] };
    for (const drillDown of [{ enabled: true, mode: 'record' }, { enabled: true, report }]) {
      const parsed = ObjectChartMirror.safeParse({ type: 'object-chart', chartType: 'bar', drillDown });
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain('unrecognized_keys');
    }
  });

  it('the ceiling on the mirror too: an undeclared MISSPELLING still parses', () => {
    // `BaseSchema` is `.passthrough()`, so this is the honest bound. Pinned
    // here rather than argued, and the counterpart to the tsc probe above.
    expect(ObjectChartMirror.safeParse({ type: 'object-chart', chartType: 'bar', drillDwn: { enabled: true } }).success).toBe(true);
  });
});

/* ── Read census on the widget file ────────────────────────────────────────── */

/**
 * Comments are STRIPPED before the census, and that is load-bearing rather than
 * tidiness: `ObjectChart.tsx` discusses `schema.chart` in prose — explaining
 * that the upstream list-view resolver could NOT be called here, because that
 * key reads `undefined` on every schema this component receives. Measured on
 * the branch point: without stripping, the census reports 17 reads including a
 * phantom `chart`; with stripping, 16 and no phantom. A census that read
 * comments could only be cleared by declaring a dead key or ledgering a
 * phantom.
 */
function stripComments(src: string): string {
  return mask(src);
}

/**
 * Every key read off `schema`, cast-aware: `schema.x`, `schema?.x`,
 * `(schema as T).x`, `schema['x']`.
 *
 * ⚠️ The cast arm matches `as T` for ANY `T`, not just `as any`. The read this
 * card exists for is spelled `(schema as { drillDown?: DrillDownConfig })
 * .drillDown`, which an `as any`-only pattern misses entirely — and a census
 * that misses a read reports the hole as clean.
 */
function schemaReads(src: string): Set<string> {
  const re = /\bschema(?:\?)?\.([A-Za-z_$][\w$]*)|\(\s*schema as [^)]*\)\.([A-Za-z_$][\w$]*)|\bschema\[['"]([A-Za-z_$][\w$]*)['"]\]/g;
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[1] ?? m[2] ?? m[3]);
  return out;
}

describe('ObjectChart.tsx — every key read off `schema` is declared or ledgered (objectui#8885)', () => {
  const source = readFileSync(join(REPO_ROOT, WIDGET_FILE), 'utf8');
  const reads = schemaReads(stripComments(source));

  it('the three keys this card declared are STILL READ — a declaration nothing reads is dead', () => {
    // Non-vacuity: a widget that read nothing off `schema` would satisfy every
    // "declared or ledgered" check below vacuously.
    expect(reads.size).toBeGreaterThan(10);
    expect(reads.has('objectName')).toBe(true);
    for (const key of DECLARED_BY_THIS_CARD) {
      expect(reads.has(key), `${key} is declared by objectui#8885 but no longer read`).toBe(true);
    }
  });

  it('every key read off `schema` is declared by the mirror, or ledgered by name', () => {
    const declared = new Set([...Object.keys(ObjectChartMirror.shape), ...LEDGERED_OTHER_CARD_READS]);
    const readNotDeclared = [...reads].filter((k) => !declared.has(k)).sort();
    expect(readNotDeclared, `${WIDGET_FILE} reads keys its schema type does not declare (objectui#6914 class)`).toEqual([]);
  });

  it('each ledgered key is still READ — a stale exception is a hole', () => {
    // The independent half of the pair: this is what keeps the equation above
    // from being widened into vacuity by adding names to the ledger.
    for (const key of LEDGERED_OTHER_CARD_READS) {
      expect(reads.has(key), `${key} is ledgered as objectui#7946's remit but no longer read`).toBe(true);
    }
  });

  it('the control keys are the OTHER card\'s, and this card moved none of them', () => {
    // "A control that breaks when the subject breaks is not a control": these
    // four are read by the same file through the same helper, so they exercise
    // the census identically — while their DISPOSITION stays objectui#7946's.
    // Whether they are declared is that card's answer; that they are read is
    // this card's assertion.
    expect([...LEDGERED_OTHER_CARD_READS].every((k) => reads.has(k))).toBe(true);
    expect(DECLARED_BY_THIS_CARD.some((k) => (LEDGERED_OTHER_CARD_READS as readonly string[]).includes(k))).toBe(false);
  });

  it('the census can see a drifted key, and does not see one that only a COMMENT mentions (non-vacuity controls)', () => {
    // A census that returned an empty set for any input would pass every
    // assertion above while measuring nothing.
    const probe = schemaReads(stripComments(
      "const a = schema.objectName; const b = (schema as { drillDown?: unknown }).drillDown; const c = schema?.title; const d = schema['drillDwn'];",
    ));
    expect([...probe].sort()).toEqual(['drillDown', 'drillDwn', 'objectName', 'title']);
    expect([...probe].filter((k) => !new Set(Object.keys(ObjectChartMirror.shape)).has(k))).toEqual(['drillDwn']);

    // The comment half. Both a block and a line comment, and a `//` inside a
    // URL, which must NOT eat the code after it.
    const commented = schemaReads(stripComments(
      "/** asked for `schema.chart` it would read undefined */\n// see schema.phantom\nconst u = 'https://example.test/x'; const a = schema.objectName;",
    ));
    expect([...commented].sort()).toEqual(['objectName']);
  });
});
