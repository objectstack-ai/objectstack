/**
 * ObjectUI — the unconsumed-widget-option warning (objectui#5709)
 *
 * The 2026-08-23 maintainer ruling on objectui#5709: a dashboard widget
 * `options` key riding `DashboardWidgetOptionsSchema.passthrough()` that no
 * renderer consumes gets an authoring-time WARNING naming the consumed set.
 * `invert` — the key the card was filed over — is the first pinned case, and
 * it is pinned here AS A CASE of the general mechanism: the same fixture shape
 * with a different dead key on a different widget type must draw the same
 * diagnostic, or the mechanism is a special case wearing a general name.
 *
 * Severity is `warning` BY RULING (no gate weakening, no new red gates), so a
 * dedicated assertion pins that no diagnostic this code emits is an error.
 *
 * The accepted-set expectations are DERIVED from
 * `CONSUMED_WIDGET_OPTION_KEYS` — the same array the implementation prints —
 * never restated, so a census update cannot desynchronize this file. The
 * derivation is guarded against vacuity first (an empty census would warn on
 * everything and make "names the consumed set" trivially true of the empty
 * string); the census itself is re-measured against spec + renderer source in
 * `dashboard-widget-options-census.test.ts` next door.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSUMED_WIDGET_OPTION_KEYS,
  UNCONSUMED_WIDGET_OPTION,
  manifestFromConfigs,
  validateTree,
} from '../index.js';
import type { Diagnostic, Manifest, SchemaElement } from '../types.js';

/**
 * A manifest carrying both widget-host blocks, with the inputs their real
 * registrations declare (`packages/plugin-dashboard/src/index.tsx`), plus a
 * non-host control block.
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
    // Spot anchor: the one key every census run in this card's history found.
    expect(CONSUMED_WIDGET_OPTION_KEYS).toContain('limit');
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
    // assert nothing (measured in this card's ablation B).
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

  it('is warning severity only — the ruled ceiling; no new red gates', () => {
    const found = unconsumed(dash(slaGauge));
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) expect(d.severity).toBe('warning');
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
    // deferred options bag), not a `$top`-style query key authored under
    // `options` — the shape `object-ui/no-query-params-under-options` exists
    // to catch in fixtures that go through a data adapter.
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

describe('the retired metric sub-caption draws the warning (objectui#11389, ruling C)', () => {
  // `options.description` was the metric tile's sub-caption, accepted on its
  // read sites. Both ends retired it (objectstack first, `@objectstack/spec`
  // 17.7.0; then every reader in `plugin-dashboard`), so it reaches no renderer
  // and is reported like any other unconsumed key. The verdict before this
  // change was no diagnostic at all; it is now one warning, never an error.
  const metric = { id: 'won_revenue', type: 'metric', dataset: 'sales', values: ['revenue'] };

  it.each([
    ['a plain string', 'Won this quarter'],
    ['an inline per-locale map', { en: 'Won this quarter', 'zh-CN': '本季度已赢单' }],
  ])('an authored options.description as %s draws one unconsumed-widget-option warning', (_label, description) => {
    const found = unconsumed(dash({ ...metric, options: { description } }));
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe('warning');
    expect(found[0]!.code).toBe(UNCONSUMED_WIDGET_OPTION);
    // The subject is named: the key, and the widget it sits on.
    expect(found[0]!.message).toContain('options.description');
    expect(found[0]!.message).toContain('"won_revenue"');
  });

  it('control: the widget-level `description` (the card-header subtitle) and a declared option draw nothing', () => {
    expect(unconsumed(dash({ ...metric, description: 'Card header subtitle', options: { limit: 5 } }))).toEqual([]);
  });
});
