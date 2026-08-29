/**
 * `unconsumed-widget-option` — the objectui#5709 ruling, ported into this copy
 * in lockstep (objectstack#12810).
 *
 * The 2026-08-23 maintainer ruling on objectui#5709: a dashboard widget
 * `options` key riding `DashboardWidgetOptionsSchema.passthrough()` that no
 * renderer consumes gets an authoring-time WARNING naming the consumed set.
 * `invert` — the key that card was filed over — is the first pinned case, and
 * it is pinned here AS A CASE of the general mechanism: the same fixture shape
 * with a different dead key on a different widget type must draw the same
 * diagnostic, or the mechanism is a special case wearing a general name.
 *
 * WHY THESE PINS EXIST HERE, AND WHY THEY CARRY MORE WEIGHT THAN OBJECTUI'S.
 * Two copies of this parser exist — objectui's `packages/sdui-parser` and this
 * hoisted one — and the invariant is that both agree on the accepted grammar
 * AND on diagnostic codes. If they drift, the save gate and the renderer speak
 * different dialects: a page can save clean and render inert, or the reverse —
 * surface-dependent, therefore intermittent from the author's point of view
 * (objectstack#12719, objectstack#12810). These pins are the objectstack half
 * of that lockstep; the emitted diagnostic is byte-equal to objectui's.
 *
 * They carry more weight here because they are the ONLY witness. This repo
 * resolves no `sdui.manifest.json` (there is none in the tree, and
 * `@objectstack/console/dist/sdui.manifest.json` is absent), so
 * `resolveSduiManifest()` returns undefined and `validateJsxPages` runs
 * parse-only — `validateTree` is not reached from the production gate at all
 * today. A green CI therefore proves almost nothing about this module; this
 * file is what proves it.
 *
 * SEVERITY IS PINNED AS WARNING deliberately, and `ok` is pinned true beside
 * it. This port reports an ALREADY-inert state (the key was legal, silent and
 * ignored before it landed), so it must leave this copy's accept/reject set
 * exactly where it stood — that is the whole reason objectstack#12810 was split
 * from objectstack#12814, which did change what this copy rejects. A test that
 * moves `ok` is reporting a contract change, not a port.
 *
 * The accepted-set expectations are DERIVED from `CONSUMED_WIDGET_OPTION_KEYS`
 * — the same array the implementation prints — never restated, so a census
 * update cannot desynchronize this file. The derivation is guarded against
 * vacuity first (an empty census would warn on everything and make "names the
 * consumed set" trivially true of the empty string).
 *
 * WHAT THIS FILE CANNOT DERIVE, so that nobody reads it as claiming to.
 * objectui's copy sits next to a census test that re-measures the accepted set
 * against its renderer source (`DatasetWidget.tsx` read sites). This repo has
 * no dashboard renderer at all, so that half is not re-derivable here and is
 * not faked: the array is pinned literally below, and the pin names the two
 * files to re-read when either half moves — this repo's
 * `packages/spec/src/ui/dashboard.zod.ts` for the declared keys, objectui's
 * `DatasetWidget.tsx` for the read sites.
 *
 * THE DECLARED HALF IS NOW RE-DERIVED — ELSEWHERE, NOT HERE (objectstack#12926).
 * The pin below asserting six literal strings is a claim about the ARRAY, and
 * on its own it pinned the parser against itself: adding a key to
 * `DashboardWidgetOptionsSchema` left it green and made it wrong. That gap is
 * closed by `scripts/check-widget-option-census.mjs`, which reads both files by
 * SOURCE TEXT and reds when a declared key is missing from the array — a gate
 * rather than a test here because this package takes no dependency on
 * `@objectstack/spec` and stays dependency-free by design. This file is
 * unchanged by that and still carries the claims the gate does not make: the
 * emitted diagnostic, its severity, and the array's own shape.
 */
import { describe, expect, it } from 'vitest';
import {
  compile,
  CONSUMED_WIDGET_OPTION_KEYS,
  UNCONSUMED_WIDGET_OPTION,
  manifestFromConfigs,
  validateTree,
} from '../index.js';
import type { Diagnostic, Manifest, SchemaElement } from '../types.js';

/**
 * A manifest carrying both widget-host blocks, with the inputs their objectui
 * registrations declare, plus a non-host control block.
 */
const manifest: Manifest = manifestFromConfigs([
  {
    type: 'dashboard',
    namespace: 'view',
    inputs: [
      { name: 'columns', type: 'number' },
      { name: 'gap', type: 'number' },
      { name: 'className', type: 'string' },
    ],
  },
  { type: 'dashboard-grid', namespace: 'plugin-dashboard', inputs: [] },
  { type: 'card', namespace: 'ui', inputs: [] },
]);

/** The objectui#5709 fixture: the hotcrm gauge, verbatim in shape. */
const slaGauge = {
  id: 'sla_compliance_gauge',
  title: 'SLA Compliance',
  type: 'gauge',
  dataset: 'case_metrics',
  values: ['avg_sla_violated'],
  options: {
    format: '0%',
    invert: true,
    thresholds: [{ value: 0.95, color: 'success' }],
  },
};

const diagnose = (node: Record<string, unknown>): Diagnostic[] =>
  validateTree(node as SchemaElement, manifest).diagnostics;

const unconsumed = (node: Record<string, unknown>): Diagnostic[] =>
  diagnose(node).filter((d) => d.code === UNCONSUMED_WIDGET_OPTION);

const dash = (...widgets: unknown[]): Record<string, unknown> => ({
  type: 'dashboard',
  widgets,
});

describe('the census the expectations derive from is not vacuous', () => {
  it('CONSUMED_WIDGET_OPTION_KEYS is non-empty, duplicate-free and sorted', () => {
    // Everything below compares against this array; an empty or degenerate
    // census would make those comparisons agree about nothing.
    expect(CONSUMED_WIDGET_OPTION_KEYS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(CONSUMED_WIDGET_OPTION_KEYS).size).toBe(CONSUMED_WIDGET_OPTION_KEYS.length);
    expect([...CONSUMED_WIDGET_OPTION_KEYS].sort()).toEqual([...CONSUMED_WIDGET_OPTION_KEYS]);
  });

  it('the accepted set is exactly objectui\'s — the lockstep pin this copy cannot re-derive', () => {
    // This repo has no dashboard renderer, so the read-site half of the census
    // is not measurable here (objectui owns it). What IS measurable here is the
    // DECLARED half: the five query keys below are exactly the five properties
    // `DashboardWidgetOptionsSchema` declares in
    // `packages/spec/src/ui/dashboard.zod.ts` — the spec ships from THIS repo,
    // so a declared key landing there without landing here would turn this
    // module into a false positive on legal metadata. `description` is the
    // sixth, undeclared, member: the metric sub-caption channel that
    // `translateDashboard` writes into `options` (see `WidgetLike.options` in
    // `packages/spec/src/system/i18n-resolver.ts`), also a read site in this
    // repo. Re-read both files when this pin fails.
    // The declared half of that sentence is re-derived by
    // `scripts/check-widget-option-census.mjs`; this pin is the array's shape.
    expect([...CONSUMED_WIDGET_OPTION_KEYS]).toEqual([
      'dateGranularity',
      'description',
      'limit',
      'sortBy',
      'sortOrder',
      'stageOrder',
    ]);
  });

  it('the manifest resolves the host blocks — reachability before absence', () => {
    expect(manifest.components['dashboard']).toBeTruthy();
    expect(manifest.components['dashboard-grid']).toBeTruthy();
    expect(diagnose(dash()).map((d) => d.code)).not.toContain('unknown-component');
  });
});

describe('the ruled first case: gauge options.invert (objectui#5709)', () => {
  it('warns on invert, thresholds AND format — none has a dataset-path read site', () => {
    const found = unconsumed(dash(slaGauge));
    const keys = found.map((d) => /options\.(\w+)/.exec(d.message)?.[1]).sort();
    expect(keys).toEqual(['format', 'invert', 'thresholds']);
  });

  it('each warning names the widget, its type, and the FULL consumed set', () => {
    const found = unconsumed(dash(slaGauge));
    // Not vacuous: an emitter that stopped emitting would make the loop below
    // assert nothing.
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) {
      expect(d.message).toContain('"sla_compliance_gauge"');
      expect(d.message).toContain('(gauge)');
      // "naming the consumed set" is the ruling's own requirement — derived
      // from the array the implementation prints, never restated.
      for (const key of CONSUMED_WIDGET_OPTION_KEYS) {
        expect(d.message).toContain(key);
      }
      expect(d.tag).toBe('dashboard');
    }
  });

  it('the emitted code IS the exported constant — the one token that diverges from objectui cannot drift', () => {
    // objectui stamps `code: UNCONSUMED_WIDGET_OPTION`; this copy stamps the
    // literal, because `check:dispatcher-error-vocabulary` cannot reduce a
    // SCREAMING_SNAKE constant holding a kebab-case value (reasoning at the
    // site). This pin is what makes that divergence safe: the two spellings are
    // asserted equal, so a change to either is a red test, not a silent fork.
    const found = unconsumed(dash({ ...slaGauge, options: { invert: true } }));
    expect(found).toHaveLength(1);
    expect(found[0]!.code).toBe(UNCONSUMED_WIDGET_OPTION);
    expect(UNCONSUMED_WIDGET_OPTION).toBe('unconsumed-widget-option');
  });

  it('the emitted diagnostic is byte-equal to objectui\'s, field for field', () => {
    // The lockstep claim is about the WHOLE envelope, not just the code: a
    // message that drifted by one word is a different author-visible dialect.
    const found = unconsumed(dash({ ...slaGauge, options: { invert: true } }));
    expect(found).toEqual([
      {
        severity: 'warning',
        code: 'unconsumed-widget-option',
        message:
          '<dashboard> widget "sla_compliance_gauge" (gauge): options.invert reaches no renderer — ' +
          'dashboard widget renderers read only: dateGranularity, description, limit, sortBy, sortOrder, stageOrder',
        tag: 'dashboard',
      },
    ]);
  });
});

describe('the port is ADDITIVE — it must not move this copy\'s accept/reject set', () => {
  // objectstack#12810 was split from objectstack#12814 precisely because this
  // half only reports an already-inert state. If any assertion here flips, the
  // port has become a contract change and must be re-graded, not merged.
  it('every diagnostic this code emits is a warning — the ruled ceiling, no new red gates', () => {
    const found = unconsumed(dash(slaGauge));
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) expect(d.severity).toBe('warning');
  });

  it('a page whose ONLY defect is a dead option key still passes the save gate', () => {
    const before = compile('<dashboard columns={2} />', manifest);
    expect(before.ok).toBe(true);
    // The same page, now carrying three unconsumed keys, is still accepted:
    // more diagnostics, same verdict.
    const after = validateTree(dash(slaGauge) as unknown as SchemaElement, manifest);
    expect(after.diagnostics.filter((d) => d.code === UNCONSUMED_WIDGET_OPTION)).toHaveLength(3);
    expect(after.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('nothing outside the census gained a diagnostic — the pre-port codes are unchanged', () => {
    // A tree with one of each pre-existing defect, none of them a widget
    // option: the codes and count are exactly what they were before the port.
    const r = compile('<dashboard columns="two" nope={1}><card /></dashboard>', manifest);
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual([
      'not-a-container',
      'type-mismatch',
      'unknown-prop',
    ]);
    expect(r.diagnostics.some((d) => d.code === UNCONSUMED_WIDGET_OPTION)).toBe(false);
  });
});

describe('the mechanism is general — invert is a case, not the implementation', () => {
  it('a different dead key on a different widget type draws the same code', () => {
    const found = unconsumed(
      dash({ id: 'k1', type: 'kpi', dataset: 'sales', values: ['total'], options: { sparkline: true } }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('options.sparkline');
    expect(found[0]!.message).toContain('"k1"');
  });

  it('fires on the dashboard-grid host too — both surfaces share one dispatch', () => {
    const found = validateTree(
      { type: 'dashboard-grid', widgets: [slaGauge] } as unknown as SchemaElement,
      manifest,
    ).diagnostics.filter((d) => d.code === UNCONSUMED_WIDGET_OPTION);
    expect(found.length).toBe(3);
    expect(found[0]!.tag).toBe('dashboard-grid');
  });

  it('a widget with no usable id is named by index', () => {
    const found = unconsumed(
      dash({ type: 'bar', dataset: 'd1', values: ['v'], options: { glow: 1 } }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('"#0"');
  });

  it('every widget in the array is visited, not just the first', () => {
    const found = unconsumed(
      dash(
        { id: 'a', type: 'bar', dataset: 'd1', options: { dead1: 1 } },
        { id: 'b', type: 'bar', dataset: 'd1', options: { dead2: 1 } },
      ),
    );
    expect(found.map((d) => d.message.match(/"(\w+)"/)?.[1])).toEqual(['a', 'b']);
  });
});

describe('what draws NOTHING — every accepted key, and every out-of-scope shape', () => {
  it('the full accepted set on one widget is clean (control: plus one dead key is not)', () => {
    const accepted = Object.fromEntries(CONSUMED_WIDGET_OPTION_KEYS.map((k) => [k, 1]));
    const widget = { id: 'w', type: 'bar', dataset: 'd1', values: ['v'] };
    expect(unconsumed(dash({ ...widget, options: accepted }))).toEqual([]);
    // The control that separates "these keys are accepted" from "the check
    // stopped running": the SAME widget with one extra key is reported.
    expect(unconsumed(dash({ ...widget, options: { ...accepted, dead: 1 } }))).toHaveLength(1);
  });

  it('a widget without `dataset` is out of census scope — the legacy inline form', () => {
    // The legacy (spec-illegal) form consumes a spread-shaped superset this
    // census deliberately does not model; a warning here would be a guess.
    expect(unconsumed(dash({ id: 'l', type: 'gauge', options: { invert: true } }))).toEqual([]);
    // …and the empty-string dataset is the same non-binding, not a binding to ''.
    expect(unconsumed(dash({ id: 'l', type: 'gauge', dataset: '', options: { invert: true } }))).toEqual([]);
  });

  it('the legacy component format is out of scope', () => {
    expect(
      unconsumed(
        dash({ id: 'c', dataset: 'd1', component: { type: 'card' }, options: { invert: true } }),
      ),
    ).toEqual([]);
  });

  it('deferred expressions are opaque, never guessed at', () => {
    // Built indirectly: this is the PARSER's `{ $expr }` marker (a whole
    // deferred options bag), the same marker `inert-expression` names — this
    // module never evaluates it and never reports on what might be inside.
    const deferredBag = { $expr: 'ctx.opts' };
    expect(unconsumed(dash({ id: 'e', type: 'gauge', dataset: 'd1', options: deferredBag }))).toEqual([]);
    expect(unconsumed({ type: 'dashboard', widgets: { $expr: 'ctx.widgets' } })).toEqual([]);
  });

  it("the spec's own suppressWarnings escape hatch is honoured (control: unsuppressed twin warns)", () => {
    const suppressed = { ...slaGauge, id: 'g1', suppressWarnings: [UNCONSUMED_WIDGET_OPTION] };
    const twin = { ...slaGauge, id: 'g2' };
    const found = unconsumed(dash(suppressed, twin));
    expect(found.every((d) => d.message.includes('"g2"'))).toBe(true);
    expect(found).toHaveLength(3);
  });

  it('a non-host component with a widgets array is not searched', () => {
    expect(unconsumed({ type: 'card', widgets: [slaGauge] })).toEqual([]);
  });

  it('an unknown host draws unknown-component, not deep option warnings', () => {
    const bare: Manifest = manifestFromConfigs([{ type: 'card', namespace: 'ui', inputs: [] }]);
    const d = validateTree(dash(slaGauge) as unknown as SchemaElement, bare).diagnostics;
    expect(d.map((x) => x.code)).toContain('unknown-component');
    expect(d.filter((x) => x.code === UNCONSUMED_WIDGET_OPTION)).toEqual([]);
  });
});
