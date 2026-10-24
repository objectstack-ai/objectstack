/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4600 — the standing validation gate for the `plugin-dashboard`
 * catalog entries, against **objectui's own component schema**.
 *
 * ## Which schema, and why this file exists at all
 *
 * The card that opened this measured all 9 entries as REJECTED and concluded
 * the corpus was teaching a shape the platform refuses. That measurement was
 * taken with `@objectstack/spec`'s `DashboardSchema` — and the maintainer
 * ruling of 2026-08-14 (objectstack#8593) says that is the wrong schema for
 * these documents, verbatim:
 *
 *   > An SDUI dashboard COMPONENT node validates against objectui's OWN
 *   > component schema; the spec's `DashboardSchema` governs stored dashboard
 *   > METADATA documents only and grows no component projection. `metric-card`
 *   > joins objectui's own CLOSED component enum as an explicitly allowed
 *   > objectui extension, not the spec widget enum.
 *
 * So the two rejection classes the card counted are non-issues by definition:
 * the missing `name` / `label` identity keys and the `{ type: 'dashboard',
 * title }` envelope are what an SDUI component node correctly looks like. Under
 * the schema the ruling names, re-measured on this tree, **9 of 9 are ACCEPTED**.
 *
 * ## Why acceptance alone is not a gate
 *
 * Measured on this tree BEFORE objectui#4600's change, `DashboardComponentSchema
 * .safeParse` also accepted:
 *
 *   - `{ type: 'zzz-not-a-widget-type', title: 'x' }` — `DashboardWidgetSchema
 *     .type` was `z.string()`, an unbounded hatch;
 *   - a widget with no `type` at all;
 *   - a widget carrying the retired pre-ADR-0021 inline analytics keys
 *     (`object` / `categoryField` / `aggregate`) — silently STRIPPED, not
 *     refused, which is the exact defect the card was opened about.
 *
 * A gate asserting only `.success` would therefore have passed by validating
 * almost nothing, which is worse than no gate: `examples/schema-catalog`'s own
 * `package.json` calls it the "single source of truth for example schemas
 * consumed by the docs site, smoke tests, and AI few-shot retrieval", and
 * `test/fields-form-hosted.test.tsx` records the objectui#3910 lesson in those
 * words — *"what they show is what gets copied."*
 *
 * This gate therefore audits three things, and the `deliberately malformed`
 * block at the bottom is the counter-probe that proves each one bites, by
 * running the SAME {@link auditEntry} the real entries run:
 *
 *   1. the entry parses under `DashboardComponentSchema`;
 *   2. every widget names a type in the CLOSED vocabulary (`DashboardWidget
 *      TypeSchema` — the spec's families plus objectui's two closed extension
 *      sets). The catalog holds itself to `type` being PRESENT, which the
 *      shared schema leaves optional for stored dashboards;
 *   3. no authored key is silently dropped. Each widget is routed to the schema
 *      that actually owns it — a `metric-card` widget slot holds an objectui
 *      COMPONENT node, so its body is `BaseSchema`'s (passthrough: `value` /
 *      `icon` / `trend` / `trendValue` are `plugin-dashboard`'s registry
 *      `inputs`, not widget keys), while every other widget is the spec-derived
 *      `DashboardWidgetSchema`'s. When this gate was written check 3 caught the
 *      stale or mis-layered keys check 1 stripped in silence; since
 *      objectui#6002 made the widget schema `.strict()` (and moved this same
 *      routing into the shared `DashboardComponentSchema` widget slot), those
 *      keys refuse loudly in checks 1 AND 3, and the dropped-key detector
 *      remains as the regression floor.
 *
 * ## Deliberately NOT catalog-wide
 *
 * Fenced to `plugin-dashboard`. objectui#4616 records 35 non-dashboard gallery
 * entries still unregistered; a catalog-wide gate lights those up and is a
 * different card with a different decision behind it.
 *
 * Sibling gate: `plugin-dashboard-global-filters-spec.test.ts` pins the
 * `globalFilters[]` sub-surface against the spec's own `GlobalFilterSchema`
 * (objectui#4356). That one is about STORED-metadata fidelity of a sub-object;
 * this one is about the component node. They are complementary, not redundant.
 */

import { describe, it, expect } from 'vitest';
import {
  BaseSchema,
  DashboardComponentSchema,
  DashboardWidgetSchema,
  DashboardWidgetTypeSchema,
  StrictAnyComponentSchema,
} from '@object-ui/types/zod';
import { DASHBOARD_COMPONENT_WIDGET_TYPES } from '@object-ui/types';
import { examplesByCategory } from '../src/index.js';

const entries = examplesByCategory('plugin-dashboard');

/** objectui COMPONENT types legal in a widget slot — the ruling's closed enum. */
const COMPONENT_WIDGET_TYPES = new Set<string>(DASHBOARD_COMPONENT_WIDGET_TYPES);

type Widget = Record<string, unknown>;

/**
 * Keys that legitimately do not survive a widget parse, and are not evidence of
 * a mis-layered document. `component` is the legacy envelope: it is declared,
 * it parses, and its BODY is a `SchemaNode` audited on its own terms — it is
 * listed here only because a nested node's key set is not this function's
 * business.
 */
const NOT_A_DROP = new Set(['component']);

/**
 * Audit ONE widget. Returns a list of human-readable problems; empty means clean.
 *
 * The routing in here is the gate's substance: which schema owns a widget is
 * decided by the ruling, not by convenience.
 */
function auditWidget(widget: Widget, where: string): string[] {
  const problems: string[] = [];

  // ── 2. the type names something in the closed vocabulary ─────────────────
  const type = widget.type;
  if (typeof type !== 'string' || type === '') {
    // A widget with no `type` is legal for the shared schema (stored dashboards
    // and the legacy `component` envelope omit it) but never for a CATALOG
    // entry: an example with no component descriptor teaches nothing and
    // renders the registry's OBJUI-001 panel.
    if (!widget.component) {
      problems.push(`${where}: no \`type\` and no \`component\` envelope — nothing names a component`);
    }
  } else {
    // Defence in depth, and deliberately so. Today `DashboardComponentSchema`
    // refuses an unknown type by itself, so check 1 already reports these — the
    // counter-probe below asserts BOTH messages appear. This restatement is
    // what survives if `DashboardWidgetSchema.type` is ever loosened back
    // toward `z.string()`, which is precisely the regression objectui#4600
    // closed: the catalog would keep its own floor instead of going quietly
    // green with the contract.
    // A slot component type (`metric-card`) is no widget type since
    // objectui#11483 — the slot reads it through its component arm alone — so
    // the vocabulary is the widget types plus the slot's component set.
    const known = COMPONENT_WIDGET_TYPES.has(type) || DashboardWidgetTypeSchema.safeParse(type).success;
    if (!known) {
      problems.push(`${where}: \`type: '${type}'\` is outside the closed widget vocabulary`);
    }
  }

  // ── 3. no authored key is silently dropped ───────────────────────────────
  // A component-extension widget IS an objectui SDUI component node, so the
  // schema that owns its body is objectui's own `BaseSchema` — the ruling's
  // "objectui's own component schema" — which is passthrough and therefore
  // keeps the component's props. Everything else is a spec-derived widget.
  //
  // Since objectui#6002 the spec-derived arm is `.strict()`, so an undeclared
  // key on that arm surfaces as a REFUSAL from the parse below (loud, key
  // named) rather than reaching the dropped-key detector. The detector stays:
  // it is the regression floor if strictness is ever loosened back toward the
  // strip regime — the same defence-in-depth stance check 2 takes for `type`.
  const isComponentNode = typeof type === 'string' && COMPONENT_WIDGET_TYPES.has(type);
  const owner = isComponentNode ? BaseSchema : DashboardWidgetSchema;
  const ownerName = isComponentNode ? 'BaseSchema (objectui component node)' : 'DashboardWidgetSchema';

  const parsed = owner.safeParse(widget);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${where}: refused by ${ownerName} — [${issue.path.join('.')}] ${issue.message}`);
    }
    return problems;
  }

  const kept = parsed.data as Record<string, unknown>;
  const dropped = Object.keys(widget).filter((key) => !NOT_A_DROP.has(key) && !(key in kept));
  if (dropped.length > 0) {
    problems.push(
      `${where}: ${ownerName} silently DROPS authored key(s) ${dropped.map((k) => `\`${k}\``).join(', ')} — ` +
      'a key no contract declares is inert metadata, and this corpus is copied verbatim by AI authors',
    );
  }
  return problems;
}

/** Audit one dashboard component node end to end. */
function auditEntry(schema: unknown, id: string): string[] {
  const problems: string[] = [];

  // ── 1. the node parses under objectui's own component schema ─────────────
  // Deliberately NOT an early return: a corpus gate should report everything
  // wrong with an entry in one run, and checks 2 and 3 are independent of this
  // one (check 3 in particular catches keys check 1 strips in silence).
  const result = DashboardComponentSchema.safeParse(schema);
  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push(`${id}: [${issue.path.join('.')}] ${issue.message}`);
    }
  }

  const widgets = (schema as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) {
    problems.push(`${id}: \`widgets\` is not an array`);
    return problems;
  }
  widgets.forEach((widget, index) => {
    if (widget === null || typeof widget !== 'object' || Array.isArray(widget)) {
      problems.push(`${id}: widgets[${index}] is not an object`);
      return;
    }
    problems.push(...auditWidget(widget as Widget, `${id}: widgets[${index}]`));
  });
  return problems;
}

describe('schema-catalog plugin-dashboard — entries validate against objectui\'s own component schema', () => {
  /**
   * NON-VACUITY CONTROLS. Both assertions below are `it.each` over collected
   * arrays, and `it.each([])` reports NOTHING rather than failing — so a
   * refactor that broke the collection (a renamed category, a changed registry
   * shape) would turn this whole gate silently green. The sibling
   * `globalFilters` gate applies the same discipline for the same reason.
   */
  it('the category is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('the sweep reaches widgets across more than one entry', () => {
    const widgetCount = entries.reduce((total, example) => {
      const widgets = (example.schema as { widgets?: unknown }).widgets;
      return total + (Array.isArray(widgets) ? widgets.length : 0);
    }, 0);
    expect(widgetCount).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(1);
  });

  it.each(entries.map((example) => [example.id, example.schema] as const))(
    '%s is a clean dashboard component node',
    (id, schema) => {
      // Surface the schema's own messages — a bare `.success` boolean tells the
      // next reader that something is wrong and nothing about what.
      expect(auditEntry(schema, id)).toEqual([]);
    },
  );

  /**
   * A `metric-card` widget really is exercised, in more than one entry — the
   * assertion above is `it.each` and would be silent if the ruling's component
   * extension vanished from the corpus. This is the pin that keeps the
   * `BaseSchema` routing arm of `auditWidget` reachable.
   */
  it('the corpus exercises the objectui component extension the ruling admits', () => {
    const componentWidgets = entries.flatMap((example) => {
      const widgets = (example.schema as { widgets?: Widget[] }).widgets ?? [];
      return widgets
        .filter((widget) => typeof widget.type === 'string' && COMPONENT_WIDGET_TYPES.has(widget.type))
        .map((widget) => ({ id: example.id, widget }));
    });
    expect(componentWidgets.length).toBeGreaterThan(0);
    expect(new Set(componentWidgets.map((w) => w.id)).size).toBeGreaterThan(1);
    // And its props genuinely survive — the whole reason the routing exists.
    for (const { id, widget } of componentWidgets) {
      const parsed = BaseSchema.parse(widget) as Record<string, unknown>;
      for (const key of Object.keys(widget)) {
        expect(Object.keys(parsed), `${id}: BaseSchema must keep \`${key}\``).toContain(key);
      }
    }
  });
});

/**
 * COUNTER-PROBE — the teeth proof.
 *
 * Every case below is a real catalog entry with ONE deliberate defect, run
 * through the SAME `auditEntry` the block above runs. If a future refactor
 * loosens the gate, these turn red before a bad example can land. Each case
 * also names WHICH of the three checks is meant to catch it, so a case that
 * starts passing for the wrong reason is visible.
 */
describe('counter-probe — the gate refuses deliberately malformed entries', () => {
  /**
   * The control must lead with a SPEC-FAMILY widget, not a component-extension
   * one: the `check 3` mutants below add a stray key to `widgets[0]`, and a
   * `metric-card` widget routes to passthrough `BaseSchema`, where nothing is
   * dropped and the probe could never bite.
   */
  const clean = entries.find((e) => {
    const widgets = (e.schema as { widgets?: Widget[] }).widgets;
    const first = Array.isArray(widgets) ? widgets[0] : undefined;
    return !!first && typeof first.type === 'string' && !COMPONENT_WIDGET_TYPES.has(first.type);
  });

  it('a clean fixture entry was found to mutate', () => {
    expect(clean).toBeDefined();
    expect(auditEntry(clean!.schema, 'control')).toEqual([]);
  });

  /** Deep-clone the control entry and hand its first widget to `mutate`. */
  const mutantOf = (mutate: (widget: Widget, doc: Record<string, unknown>) => void) => {
    const doc = JSON.parse(JSON.stringify(clean!.schema)) as Record<string, unknown>;
    mutate((doc.widgets as Widget[])[0], doc);
    return doc;
  };

  const cases: Array<[string, (w: Widget, d: Record<string, unknown>) => void, RegExp]> = [
    [
      'check 2 — a widget type nothing registers (the OBJUI-001 red panel at runtime)',
      (w) => { w.type = 'metrci-card'; },
      // Both halves must fire: the shared schema's own enum message AND the
      // catalog's restatement of it. Order-insensitive lookaheads since
      // objectui#6002: the doc-level parse (check 1) now reports the widget
      // slot's union as a bare `Invalid input`, so the enum message reaches
      // the report through check 3's routed parse, AFTER the restatement.
      /^(?=[\s\S]*Invalid option: expected one of)(?=[\s\S]*outside the closed widget vocabulary)/,
    ],
    [
      'check 2 — a chart family the spec retired',
      (w) => { w.type = 'heatmap'; },
      /^(?=[\s\S]*Invalid option: expected one of)(?=[\s\S]*outside the closed widget vocabulary)/,
    ],
    [
      'check 2 — a widget naming no component at all',
      (w) => { delete w.type; },
      /no `type` and no `component` envelope/,
    ],
    [
      // Pre-#6002 these two were caught by the dropped-key detector
      // (`silently DROPS authored key(s)`); the strict widget schema now
      // refuses them upstream of it, naming every key (objectui#6002).
      'check 3 — the pre-ADR-0021 inline analytics keys this card was opened about',
      (w) => { w.object = 'opportunity'; w.categoryField = 'stage'; w.aggregate = 'sum'; },
      /refused by DashboardWidgetSchema[\s\S]*Unrecognized keys[\s\S]*"object"[\s\S]*"categoryField"[\s\S]*"aggregate"/,
    ],
    [
      'check 3 — a single mis-layered renderer setting left at widget top level',
      (w) => { w.dateGranularity = 'month'; },
      // zod prints the singular `Unrecognized key:` for a single offender.
      /refused by DashboardWidgetSchema[\s\S]*Unrecognized keys?[\s\S]*"dateGranularity"/,
    ],
    [
      'check 1 — a retired key the spec tombstoned, refused rather than dropped',
      (w) => { w.actionUrl = '/opportunities'; },
      /actionUrl/,
    ],
    [
      'check 1 — the dashboard envelope itself broken',
      (_w, d) => { d.type = 'dashbaord'; },
      /type/,
    ],
  ];

  it.each(cases)('%s', (_label, mutate, expected) => {
    const problems = auditEntry(mutantOf(mutate), 'mutant');
    expect(problems.length, 'the mutant must be reported').toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(expected);
  });

  /**
   * The counter-probe's own counter-probe: mutating NOTHING must stay clean.
   * Without this, a bug that made `auditEntry` report on every input would make
   * every case above pass while the gate rejected the whole corpus.
   */
  it('an unmutated clone is still clean', () => {
    expect(auditEntry(mutantOf(() => {}), 'unmutated')).toEqual([]);
  });
});

/**
 * objectui#11228 ruling C (objectui#11070 round 6): a dashboard widget binds a
 * `dataset` and never carries rows. The strict authoring face keeps refusing
 * the inline dialect by name (`widgets[].options.{data, xField, yField, value,
 * description, trend}` and `widgets[].component.{chartType, xAxisKey,
 * series}`, pinned key by key in `packages/types`'
 * `strict-face-read-keys-11070.test.ts`), and this corpus is what AI authors
 * copy, so it teaches none of it: every entry parses on the published strict
 * face. The `filtered-dashboard*` entries carried the dialect until that round
 * moved them to the dataset form.
 */
describe('schema-catalog plugin-dashboard — every entry parses on the strict authoring face (objectui#11228 ruling C)', () => {
  it.each(entries.map((example) => [example.id, example.schema] as const))(
    '%s parses on StrictAnyComponentSchema',
    (_id, schema) => {
      const result = StrictAnyComponentSchema.safeParse(schema);
      expect(result.success ? [] : result.error.issues.map((i) => `[${i.path.join('.')}] ${i.code}`)).toEqual([]);
    },
  );
});
