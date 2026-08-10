import { describe, it, expect } from 'vitest';
import {
  ChartTypeSchema,
  ChartConfigSchema,
  ChartAxisSchema,
  ChartSeriesSchema,
  ChartAnnotationSchema,
  ChartInteractionSchema,
  ChartAggregateSchema,
  ChartGroupBySchema,
  ChartDrillDownSchema,
  type ChartType,
  type ChartConfig,
} from './chart.zod';
import { ReportChartSchema, ReportSchema } from './report.zod';
import { REACT_BLOCKS } from './react-blocks';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { measureDoors } from './door-reachability.testkit';
import { z } from 'zod';

describe('ChartTypeSchema', () => {
  it('should accept all comparison chart types', () => {
    const types = ['bar', 'horizontal-bar', 'column'] as const;

    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should accept all trend chart types', () => {
    const types = ['line', 'area'] as const;

    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should accept all distribution chart types', () => {
    const types = ['pie', 'donut', 'funnel'] as const;
    
    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should accept all relationship chart types', () => {
    const types = ['scatter'] as const;

    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should accept all composition chart types', () => {
    const types = ['treemap', 'sankey'] as const;

    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should accept the mixed chart type', () => {
    // `combo` draws bar/line/area series together on left/right axes — the
    // family `ChartSeriesSchema.type` and `ChartSeriesSchema.yAxis` configure.
    expect(() => ChartTypeSchema.parse('combo')).not.toThrow();
  });

  it('should accept all performance chart types', () => {
    const types = ['gauge', 'metric', 'kpi'] as const;

    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should accept all advanced chart types', () => {
    const types = ['radar'] as const;

    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject chart types dropped from the taxonomy (unimplementable)', () => {
    const removed = ['sunburst', 'word-cloud', 'choropleth', 'bubble-map', 'gl-map',
      'heatmap', 'waterfall', 'box-plot', 'violin', 'candlestick', 'stock'] as const;

    removed.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).toThrow();
    });
  });

  it('should reject variant types that only render as their base chart', () => {
    // Removed: each fell back to a base family the renderer already draws, so
    // advertising them lied about the output (see the taxonomy NOTE in chart.zod).
    const fallbackOnly = ['grouped-bar', 'stacked-bar', 'bi-polar-bar', 'stacked-area',
      'step-line', 'spline', 'pyramid', 'bubble'] as const;

    fallbackOnly.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).toThrow();
    });
  });

  it('should accept all tabular chart types', () => {
    const types = ['table', 'pivot'] as const;
    
    types.forEach(type => {
      expect(() => ChartTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid chart type', () => {
    expect(() => ChartTypeSchema.parse('invalid-chart')).toThrow();
  });
});

describe('ChartConfigSchema', () => {
  it('should accept minimal chart config', () => {
    const config: ChartConfig = {
      type: 'bar',
    };
    const result = ChartConfigSchema.parse(config);
    expect(result.type).toBe('bar');
    expect(result.showLegend).toBe(true);
    expect(result.showDataLabels).toBe(false);
  });

  it('should accept full chart config', () => {
    const config: ChartConfig = {
      type: 'line',
      title: 'Sales Trend',
      description: 'Monthly sales performance',
      showLegend: true,
      showDataLabels: true,
      colors: ['#FF6384', '#36A2EB', '#FFCE56'],
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply default values', () => {
    const config: ChartConfig = {
      type: 'pie',
      title: 'Revenue by Region',
    };
    const result = ChartConfigSchema.parse(config);
    expect(result.showLegend).toBe(true);
    expect(result.showDataLabels).toBe(false);
  });

  it('should allow custom colors', () => {
    const config: ChartConfig = {
      type: 'donut',
      colors: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728'],
    };
    const result = ChartConfigSchema.parse(config);
    expect(result.colors).toHaveLength(4);
  });
});

describe('Real-World Chart Configuration Examples', () => {
  it('should accept bar chart for comparison', () => {
    const config: ChartConfig = {
      type: 'bar',
      title: 'Sales by Product Category',
      description: 'Comparison of sales across different product categories',
      showLegend: true,
      showDataLabels: true,
      colors: ['#4e79a7', '#f28e2c', '#e15759'],
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept line chart for trends', () => {
    const config: ChartConfig = {
      type: 'line',
      title: 'Revenue Trend',
      description: 'Monthly revenue over the past year',
      showLegend: true,
      showDataLabels: false,
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept pie chart for distribution', () => {
    const config: ChartConfig = {
      type: 'pie',
      title: 'Market Share',
      description: 'Market share by competitor',
      showLegend: true,
      showDataLabels: true,
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept gauge for performance metrics', () => {
    const config: ChartConfig = {
      type: 'gauge',
      title: 'Customer Satisfaction Score',
      description: 'Current satisfaction rating (0-100)',
      showLegend: false,
      colors: ['#22c55e', '#eab308', '#ef4444'],
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept treemap for composition analysis', () => {
    const config: ChartConfig = {
      type: 'treemap',
      title: 'Hours by Status',
      description: 'Relative size of each status bucket',
      showLegend: true,
      showDataLabels: false,
      colors: ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B'],
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept funnel chart for conversion tracking', () => {
    const config: ChartConfig = {
      type: 'funnel',
      title: 'Sales Funnel',
      description: 'Conversion rates at each stage',
      showLegend: false,
      showDataLabels: true,
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });

  it('should accept sankey chart for flow analysis', () => {
    const config: ChartConfig = {
      type: 'sankey',
      title: 'Status Flow',
      description: 'Flow weighted by record count',
      showLegend: false,
      showDataLabels: true,
      colors: ['#22c55e', '#ef4444', '#6366f1'],
    };
    expect(() => ChartConfigSchema.parse(config)).not.toThrow();
  });
});

describe('Chart I18n Integration', () => {
  it('should reject i18n object as chart title', () => {
    expect(() => ChartConfigSchema.parse({
      type: 'bar',
      title: { key: 'charts.sales', defaultValue: 'Sales Chart' },
    })).toThrow();
  });
  it('should reject i18n as chart subtitle and description', () => {
    expect(() => ChartConfigSchema.parse({
      type: 'line',
      title: 'Revenue',
      subtitle: { key: 'charts.subtitle', defaultValue: 'Monthly breakdown' },
      description: { key: 'charts.desc', defaultValue: 'Revenue over time' },
    })).toThrow();
  });
});

describe('Chart ARIA Integration', () => {
  it('should accept chart with ARIA attributes', () => {
    expect(() => ChartConfigSchema.parse({
      type: 'pie',
      title: 'Revenue by Region',
      aria: { ariaLabel: 'Pie chart showing revenue by region', role: 'img' },
    })).not.toThrow();
  });
});

// ============================================================================
// #4001 批 15 — the SPLIT verdict, pinned.
//
// Five sites are closed and two are deliberately open, on a door measurement.
// Both halves are pinned here, because both can regress and they regress in
// OPPOSITE directions: the closed half by someone reopening it, the open half
// by a later sweep "finishing the file" with a `strictObject` that gates
// nothing (#4583). The same verdict is recorded in `chart.zod.ts`'s header and
// in the ui/ row of `docs/audits/2026-07-unknown-key-strictness-ledger.md`.
//
// UPDATE (#5020): the open half's verdict moved from `no gate` to `authorable`
// — the react-page publish lint now PARSES `ChartAggregateSchema` instead of
// re-deriving it, so a `strictObject` here would no longer gate nothing. The
// posture itself was unchanged by that step, which is the whole reason it was
// its own step.
//
// UPDATE (#5583): the posture moved too, and the file is now 0 strip. The split
// is history rather than a live classification — the `chart.zod.ts` row left the
// ledger's remaining-strip map on the reverse pin (a row that outlives its work
// fails), and the two "still STRIPS" pins below were INVERTED in place. What the
// pair still guards is the ORDER: parse first, posture second. A sweep that
// meets a `no gate` verdict elsewhere and closes it in passing is the failure
// this file was written to make visible (#4583).
// ============================================================================
describe('#4001 批 15 — the five closed chart sites', () => {
  const reject = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown } } }, value: unknown): string => {
    const r = schema.safeParse(value);
    expect(r.success, 'expected this to be REJECTED').toBe(false);
    return JSON.stringify(r.error?.issues ?? []);
  };

  it('the controls parse — these tests fail closed, not by rejecting everything', () => {
    expect(ChartConfigSchema.safeParse({ type: 'bar' }).success).toBe(true);
    expect(ChartAxisSchema.safeParse({ field: 'status' }).success).toBe(true);
    expect(ChartSeriesSchema.safeParse({ name: 'total' }).success).toBe(true);
    expect(ChartAnnotationSchema.safeParse({ value: 10 }).success).toBe(true);
    expect(ChartInteractionSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ['ChartConfigSchema', () => ChartConfigSchema, { type: 'bar', notAChartKey: 1 }],
    ['ChartAxisSchema', () => ChartAxisSchema, { field: 'f', notAnAxisKey: 1 }],
    ['ChartSeriesSchema', () => ChartSeriesSchema, { name: 'n', notASeriesKey: 1 }],
    ['ChartAnnotationSchema', () => ChartAnnotationSchema, { value: 1, notAnAnnotationKey: 1 }],
    ['ChartInteractionSchema', () => ChartInteractionSchema, { notAnInteractionKey: 1 }],
  ])('%s rejects an undeclared key', (_name, get, value) => {
    expect(reject(get() as never, value)).toContain(Object.keys(value).slice(-1)[0]);
  });

  // ---- the door: a strict schema nobody parses gates nothing -----------
  it('the door is the dashboard metadata root, not just the exported schema', () => {
    const dash = getMetadataTypeSchema('dashboard');
    expect(dash, 'dashboard must resolve a schema — this is the parse door').toBeTruthy();
    const widget = (chartConfig: Record<string, unknown>) => ({
      name: 'dash_one', label: 'D',
      widgets: [{ id: 'w1', type: 'bar', title: 'W', dataset: 'ds', dimensions: ['a'], values: ['b'], chartConfig }],
    });
    expect(dash!.safeParse(widget({ type: 'bar' })).success, 'control').toBe(true);
    const r = dash!.safeParse(widget({ type: 'bar', chartType: 'bar' }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('widgets');
  });

  it('strictness RIDES `.extend()` onto ReportChartSchema — the webhook/view trap, here on purpose', () => {
    // `.extend()` inherits `.strict()` AND the error map. `ReportChartSchema`
    // narrows xAxis/yAxis to dataset names and adds no key of its own, so the
    // inherited key set is exactly right — but that has to be asserted, not
    // assumed, because the same mechanic is what made finding 16 a finding.
    expect(ReportChartSchema.safeParse({ type: 'bar', xAxis: 'dim', yAxis: 'measure' }).success, 'control').toBe(true);
    const msg = reject(ReportChartSchema as never, { type: 'bar', xAxis: 'd', yAxis: 'm', chartType: 'bar' });
    expect(msg).toContain('chartType');
    expect(msg, 'the base error map rides too, so the report surface gets the rename').toContain('`chartType` → `type`');
  });

  // ---- curation, each entry measured against a named sibling ----------
  it('crosses the axis/series vocabulary in BOTH directions', () => {
    // Same file, sixty lines apart: the axis binds `field`/`title`, the series
    // binds `name`/`label`. Neither is a typo for the other.
    expect(reject(ChartAxisSchema as never, { field: 'f', name: 'status' })).toContain('`name` → `field`');
    expect(reject(ChartSeriesSchema as never, { name: 'n', field: 'total' })).toContain('`field` → `name`');
    expect(reject(ChartAxisSchema as never, { field: 'f', label: 'x' })).toContain('`label` → `title`');
    expect(reject(ChartSeriesSchema as never, { name: 'n', title: 'x' })).toContain('`title` → `label`');
  });

  it('renames Recharts prop names onto the spec keys — the renderer an author debugs against', () => {
    expect(reject(ChartAxisSchema as never, { field: 'f', dataKey: 'x' })).toContain('`dataKey` → `field`');
    expect(reject(ChartSeriesSchema as never, { name: 'n', stackId: 'g' })).toContain('`stackId` → `stack`');
    expect(reject(ChartSeriesSchema as never, { name: 'n', strokeDasharray: '4 4' })).toContain('`strokeDasharray` → `dashArray`');
  });

  it('renames a region\'s range vocabulary onto value/endValue', () => {
    // Getting `endValue` wrong collapses the region to a line at `value`.
    const msg = reject(ChartAnnotationSchema as never, { value: 1, from: 1, to: 2 });
    expect(msg).toContain('`from` → `value`');
    expect(msg).toContain('`to` → `endValue`');
  });

  it('carries the #3752 tombstones, one distinct sentence each (批 10)', () => {
    const zoom = reject(ChartInteractionSchema as never, { zoom: true });
    expect(zoom).toContain('#3752');
    expect(zoom).toContain('brush: true');
    const click = reject(ChartInteractionSchema as never, { clickAction: 'x' });
    expect(click).toContain('#3752');
    expect(click).toContain('onSegmentClick');
    // Two keys at once ⇒ two DISTINCT bullets, not one string printed twice.
    const both = reject(ChartInteractionSchema as never, { zoom: true, clickAction: 'x' });
    expect(both.split('• ').length - 1).toBe(2);
  });

  it('never prescribes a BARE `drillDown` — the key exists now, but not on this surface', () => {
    // RECONCILED with #5022, not relaxed.
    //
    // 批 15 pinned this because the #3752 prose said "Migration: `drillDown`"
    // for a key the protocol declared nowhere — prescribing it would have lent
    // an author the platform's authority for a key the same gate then rejects
    // (finding 7, third occurrence). #5022 declared the key, so the ORIGINAL
    // reason is gone. The pin survives on a second, independent one:
    //
    // `ChartInteractionSchema` is reached from BOTH tiers — a dashboard
    // widget's `chartConfig.interaction` and the react `<ObjectChart>` block —
    // and cannot tell which. `drillDown` is a REACT-TIER prop only; a dataset-
    // bound dashboard widget drills through the semantic layer and reads no
    // drill config at all. So a bare prescription here would be sound advice
    // for half its readers and a dead end for the other half. That is the same
    // finding wearing a different hat, so the assertion is unchanged and its
    // justification is what moved. Surface-qualified prescriptions live where
    // the surface IS knowable — see the two tests below.
    const msg = reject(ChartInteractionSchema as never, { clickAction: 'x' });
    expect(msg).not.toContain('drillDown');
    expect(msg, 'it must name something that exists instead').toContain('drilldown');
  });

  it('a `drillDown` written INSIDE the chart config is rejected, and told which surface owns it', () => {
    // The chart-config level DOES know its surface, so here the prescription is
    // allowed — and required. Without it, #5022's declaration would make
    // `widget.chartConfig.drillDown` look plausible to the next author.
    const msg = reject(ChartConfigSchema as never, { type: 'bar', drillDown: { enabled: true } });
    expect(msg).toContain('ObjectChart');
    expect(msg, 'names the react tier as the owner').toContain('REACT-TIER');
    expect(msg, 'and says what a dashboard does instead').toContain('semantic layer');
    expect(msg, 'and disambiguates the report near-key').toContain('drilldown');
  });

  it('points wrong-layer keys at the layer that owns them, naming a real key', () => {
    const width = reject(ChartConfigSchema as never, { type: 'bar', width: 400 });
    expect(width).toContain('layout.w');
    const stacked = reject(ChartConfigSchema as never, { type: 'bar', stacked: true });
    expect(stacked).toContain('series[].stack');
    const dataset = reject(ChartConfigSchema as never, { type: 'bar', dataset: 'ds' });
    expect(dataset).toContain('ADR-0021');
  });

  it('every alias target it suggests is a key the schema accepts', () => {
    // The `triggerPhrases` lesson (`shared/strict-object.ts`): never point an
    // author at a key that rejects them a second time.
    const shapeOf = (s: unknown) => Object.keys((s as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape);
    expect(shapeOf(ChartConfigSchema)).toEqual(expect.arrayContaining(['type', 'colors', 'showLegend', 'showDataLabels', 'annotations', 'interaction', 'subtitle', 'aria', 'height', 'xAxis', 'yAxis']));
    expect(shapeOf(ChartAxisSchema)).toEqual(expect.arrayContaining(['field', 'title', 'showGridLines', 'stepSize', 'logarithmic', 'min', 'max', 'format', 'position']));
    expect(shapeOf(ChartSeriesSchema)).toEqual(expect.arrayContaining(['name', 'label', 'type', 'stack', 'yAxis', 'variant', 'dashArray', 'opacity', 'color']));
    expect(shapeOf(ChartAnnotationSchema)).toEqual(expect.arrayContaining(['value', 'endValue', 'label', 'style', 'color', 'axis', 'type']));
    expect(shapeOf(ChartInteractionSchema)).toEqual(expect.arrayContaining(['tooltips', 'brush']));
  });
});

describe('#4001 批 15 — the two chart sites left open on a measurement, CLOSED at #5583', () => {
  // `ChartAggregateSchema` and `ChartGroupBySchema`'s object arm have a LIVE
  // carrier — the react tier's `<ObjectChart aggregate={…}>` prop, which
  // objectui's ObjectChart reads to run the query — and, as of **#5020**, a
  // PARSE: the react-page publish lint calls `ChartAggregateSchema.safeParse()`
  // instead of re-deriving the vocabulary and the count/field refinement by
  // hand. That retired the 批 15 `no gate` verdict and made both sites ordinary
  // `authorable` ones; **#5583** then moved the posture, which is what the two
  // pins below now record.
  //
  // ⚠️ They are the SAME two assertions 批 15 wrote, INVERTED — deliberately
  // rewritten rather than deleted, because the pair is what makes the two-step
  // order legible: the key that used to come back stripped now comes back as a
  // named rejection, from the same input, at the same site. A reader who lands
  // here from a future sweep should be able to see both states. The companion
  // pins live in `packages/lint`'s `validate-react-page-props.test.ts`, which
  // inverted in the same PR.
  it('ChartAggregateSchema REJECTS an undeclared key, by name (#5583 — was a silent strip)', () => {
    const r = ChartAggregateSchema.safeParse({ function: 'count', groupBy: 'status', groupby: 'status' });
    expect(r.success, 'if this parses again the strictness was reverted — re-read the header in chart.zod.ts').toBe(false);
    const issue = r.error!.issues[0];
    expect(issue.code).toBe('unrecognized_keys');
    // The three things a named rejection owes an author: the surface, the
    // offending key echoed back, and the rename. `groupby` → `groupBy` comes
    // from the FOLDED edit distance, not from an alias entry — asserted here so
    // a later "curation" that adds the redundant alias has a reason not to.
    expect(issue.message).toContain('this chart aggregate');
    expect(issue.message).toContain('`groupby`');
    expect(issue.message).toContain('`groupby` → `groupBy`');

    // The curated half, on the key this file's own header named as the
    // expensive one: written BESIDE `groupBy`, `dateGranularity` did nothing.
    const wrongLayer = ChartAggregateSchema.safeParse({ function: 'count', groupBy: 'created_at', dateGranularity: 'month' });
    expect(wrongLayer.success).toBe(false);
    expect(wrongLayer.error!.issues[0].message).toContain('goes INSIDE `groupBy`');

    // Control, in the SAME run: a declaration that was legal before is legal
    // now. A strictness pin that only shows rejections is satisfiable by a
    // schema that rejects everything.
    expect(ChartAggregateSchema.safeParse({ function: 'count', groupBy: 'status' }).success).toBe(true);
  });

  it("ChartGroupBySchema's object arm REJECTS an undeclared key — and the UNION collapses its message (#5583)", () => {
    const r = ChartGroupBySchema.safeParse({ field: 'created_at', dateGranularty: 'month' });
    expect(r.success).toBe(false);

    // ⚠️ The zod-4 union collapse, pinned as a RAW SHAPE rather than described.
    // `groupBy` is a union, so the arm's `unrecognized_keys` never reaches
    // `error.issues`: what surfaces is ONE `invalid_union` whose own message is
    // the bare string "Invalid input". A consumer that renders `issue.message`
    // verbatim shows the author nothing at all (#5014), which is why
    // `packages/lint/src/zod-issue-format.ts` unpacks `issue.errors` — and why
    // that unpacking had to exist BEFORE this schema was closed.
    const top = r.error!.issues[0] as { code: string; message: string; errors?: unknown[][] };
    expect(top.code, 'the strict arm does NOT surface as unrecognized_keys').toBe('invalid_union');
    expect(top.message, 'the collapsed message carries nothing an author can act on').toBe('Invalid input');

    // The named rejection is reachable, one level in — this is exactly what the
    // lint side reads, so if this shape ever changes the unpacking breaks with it.
    const armMessages = (top.errors ?? []).flat().map((i) => (i as { message: string }).message);
    expect(armMessages.some((m) => m.includes('this chart groupBy'))).toBe(true);
    expect(armMessages.some((m) => m.includes('`dateGranularty` → `dateGranularity`'))).toBe(true);

    // Controls in the same run: both accepted forms still parse.
    expect(ChartGroupBySchema.safeParse({ field: 'created_at', dateGranularity: 'month', alias: 'month' }).success).toBe(true);
    expect(ChartGroupBySchema.safeParse('status').success).toBe(true);
  });

  it('neither is REACHABLE from the metadata-type roots — the measurement, re-run every CI', () => {
    // The standing half of the door measurement, so the verdict cannot go
    // stale in silence: the day someone gives `aggregate` a metadata carrier
    // key this goes red and points them back at the header comment.
    //
    // It is a real BFS over this build's in-memory Zod graph from every
    // metadata-type root plus `defineStack`'s `ObjectStackSchema` — the same
    // closure `build-schemas.ts` uses for the #4650 deletion check — NOT a
    // string search over a serialized schema, which cannot see a shape at all
    // and would pass no matter what (the vacuous-green this campaign keeps
    // paying for). The controls below are what prove that.
    //
    // ⚠️ #5056: this file used to carry its OWN copy of that walk, and the copy
    // kept the defective `any one shared property ⇒ derived clone` bridge after
    // the shared walker had been fixed to a whole-shape overlap ratio. One
    // implementation now, in `door-reachability.testkit.ts`, whose own controls
    // live in `door-reachability.testkit.test.ts`.
    const { verdict, nodeCount, rootCount } = measureDoors();

    // Controls FIRST, in the SAME run. An instrument that reached nothing at
    // all produces the same output as a correct "no door" verdict.
    expect(rootCount, 'roots must include every metadata type plus ObjectStackSchema').toBeGreaterThan(20);
    expect(nodeCount, 'the graph must actually have been walked').toBeGreaterThan(1000);

    // Positive controls: the five closed sites of this file resolve.
    expect(verdict(ChartConfigSchema), 'positive control').toBe('direct');
    expect(verdict(ChartAxisSchema), 'positive control').toBe('direct');
    expect(verdict(ChartSeriesSchema), 'positive control').toBe('direct');
    expect(verdict(ChartAnnotationSchema), 'positive control').toBe('direct');
    expect(verdict(ChartInteractionSchema), 'positive control').toBe('direct');

    // Negative control: a shape this graph has never seen must stay out.
    expect(verdict(z.object({ osChartProbe: z.string() })), 'negative control').toBe('unreachable');

    // The measurement itself.
    expect(verdict(ChartAggregateSchema), 'a carrier key would make this reachable — re-read chart.zod.ts').toBe('unreachable');
    expect(verdict(ChartGroupBySchema), 'a carrier key would make this reachable — re-read chart.zod.ts').toBe('unreachable');
  });

  it('a synthetic carrier flips both — the verdict is the graph, not the walker', () => {
    // The third control #5056 requires and this file never had. Without it the
    // assertion above is satisfiable by a walker that finds no doors anywhere,
    // which is the vacuous green 批 15 shipped once already.
    const carrier = z.object({
      aggregate: ChartAggregateSchema,
      groupBy: ChartGroupBySchema,
    });
    const { verdict } = measureDoors([carrier]);
    expect(verdict(ChartAggregateSchema), 'must become reachable once something carries it').toBe('direct');
    expect(verdict(ChartGroupBySchema), 'must become reachable once something carries it').toBe('direct');
  });
});

// ============================================================================
// #5022 — `ChartDrillDownSchema`: a live renderer capability, finally declared.
//
// The gap 批 15 found and filed: objectui's `ObjectChart` read
// `(schema as any).drillDown` and really did drive a drill drawer from it,
// while the protocol declared the key nowhere. Declared here at the surface
// that measurably reads it — the REACT TIER — and nowhere else, because the
// dashboard metadata path reads no drill config at all.
//
// The per-key tests below are the acceptance criteria in schema form: every
// declared key is one an `ObjectChart.tsx` read point was measured for, and
// nothing else got in.
// ============================================================================
describe('#5022 — ChartDrillDownSchema', () => {
  const reject = (value: unknown): string => {
    const r = ChartDrillDownSchema.safeParse(value);
    expect(r.success, 'expected this to be REJECTED').toBe(false);
    return JSON.stringify(r.error?.issues ?? []);
  };

  it('declares exactly the six keys ObjectChart was measured to read — no more', () => {
    // The honest subset. objectui's renderer-side `DrillDownConfig` is wider
    // (`mode` / `report`, and — until objectui#3354 removed them — `view` /
    // `sort`) because it is shared with the table / pivot / metric widgets. A
    // chart reads none of those, so copying the union would have promoted keys
    // a chart ignores into protocol-declared capabilities. This assertion is
    // what stops the next sweep "completing" the shape from the objectui type.
    //
    // The KEY set is what this pins. `target`'s VALUE union is a separate
    // question with a separate answer: #5435 widened it to include `'navigate'`
    // once objectui#3382 made ObjectChart honour that arm — declared because
    // delivered, which is the same rule as this assertion, not an exception.
    const shape = Object.keys(
      (ChartDrillDownSchema as unknown as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape,
    );
    expect(shape.sort()).toEqual(['columns', 'enabled', 'filter', 'maxRows', 'target', 'title']);
  });

  it.each([
    ['enabled', { enabled: false }],
    ['filter', { filter: { stage: '${event.category}' } }],
    ['title', { title: '${event.categoryLabel} deals' }],
    ['target drawer', { target: 'drawer' }],
    ['target dialog', { target: 'dialog' }],
    ['target navigate', { target: 'navigate' }],
    ['columns', { columns: ['name', 'amount'] }],
    ['maxRows', { maxRows: 50 }],
    ['everything at once', {
      enabled: true,
      filter: { stage: '${event.category}' },
      title: 'Deals',
      target: 'dialog' as const,
      columns: ['name'],
      maxRows: 25,
    }],
  ])('accepts %s', (_name, value) => {
    expect(ChartDrillDownSchema.safeParse(value).success).toBe(true);
  });

  it('`{}` is a valid config — the block being present is what turns drill on', () => {
    // `isDrillEnabled` in objectui reads `config.enabled !== false`, so an
    // empty object enables. A schema that demanded `enabled` would contradict
    // the renderer it was reverse-engineered from.
    expect(ChartDrillDownSchema.safeParse({}).success).toBe(true);
  });

  it('stays OPTIONAL — a chart with no drillDown is the norm, not an omission', () => {
    // Absence means drill OFF. Nothing may require this block.
    expect(ChartDrillDownSchema.optional().safeParse(undefined).success).toBe(true);
  });

  it('rejects an unknown key inside the block, naming the surface and suggesting the near one', () => {
    const msg = reject({ enabled: true, maxrows: 10 });
    expect(msg, 'the surface is named').toContain('chart drill-down block');
    expect(msg, 'and the offending key echoed').toContain('maxrows');
    expect(msg, 'and the closest declared key offered').toContain('`maxrows` → `maxRows`');
  });

  it.each([
    ['limit', 'maxRows'],
    ['pageSize', 'maxRows'],
    ['fields', 'columns'],
    ['where', 'filter'],
    ['openIn', 'target'],
  ])('renames the renderer/SQL vocabulary an author brings: %s → %s', (wrong, right) => {
    expect(reject({ [wrong]: 1 })).toContain(`\`${wrong}\` → \`${right}\``);
  });

  it.each([
    ['mode', 'TABLE / PIVOT / METRIC'],
    ['report', 'METRIC / PIVOT'],
    ['view', 'objectui#3354'],
    ['sort', 'objectui#3354'],
  ])('`%s` is rejected with the reason it is absent, not a rename', (key, expected) => {
    // Each of these is REAL somewhere — on another widget, or (view/sort) in a
    // renderer type that nothing reads. Edit distance would have proposed a
    // rename to an unrelated key; a `guidance` entry suppresses that and says
    // what the key actually is.
    const msg = reject({ [key]: key === 'sort' ? [] : 'x' });
    expect(msg).toContain(expected);
    expect(msg, 'a guidance entry suppresses the rename suggestion').not.toContain(`\`${key}\` → `);
  });

  it("target: 'navigate' is ACCEPTED — objectui#3382 made the renderer deliver it (#5435)", () => {
    // This test asserted the exact opposite until #5435, and the flip is the
    // point: #5022 excluded `'navigate'` on a MEASUREMENT ("ObjectChart falls
    // through to the Sheet"), not on a design preference. objectui#3382
    // implemented the arm, the measurement expired, and the union followed.
    //
    // Kept as a NAMED case rather than folded into the `accepts` table above
    // so that a future sweep re-narrowing the union has to delete a test whose
    // title states why the arm exists, instead of quietly dropping a row.
    expect(ChartDrillDownSchema.safeParse({ target: 'navigate' }).success).toBe(true);

    // The prescription that used to fire for this value must be GONE, not
    // merely unreachable — a rejection message asserting a chart "does not
    // implement that arm" is now false, and #5046's lesson is that a dead limb
    // left in place reads as live to the next author.
    const msg = reject({ target: 'sidebar' });
    expect(msg, 'the retired navigate prescription must not survive').not.toContain('objectui#3354');
    expect(msg, 'nor its claim about what a chart cannot do').not.toContain('not supported by a chart');
  });

  it('a target outside the three declared arms is still rejected — widening is not loosening', () => {
    // The companion to the case above. `'navigate'` became legal because a
    // renderer delivers it; `target` did not stop being an enum. Without this,
    // deleting the union entirely would leave the suite green.
    const msg = reject({ target: 'sidebar' });
    expect(msg, 'rejected as a value, not swallowed').toContain('invalid_value');
    // Zod's own enum message enumerates the legal arms rather than echoing the
    // bad input, so THIS is the string that proves the union still has exactly
    // three members — and it fails loudly if a fourth is ever slipped in.
    expect(msg, 'and the three arms that do work are named').toContain('"values":["drawer","dialog","navigate"]');
  });

  // ---- the near-key, both directions (the 2026-08-04 ruling, item 3) -------
  it('`drilldown` (lowercase) on the CHART points at the report boolean', () => {
    const msg = reject({ drilldown: true });
    expect(msg).toContain('ReportSchema.drilldown');
    expect(msg, 'names the type difference, not just the spelling').toContain('BOOLEAN');
    expect(msg).toContain('capital D');
  });

  it('`drillDown` (camelCase) on the REPORT points back at the chart prop', () => {
    // The direction edit distance actively gets WRONG: `drillDown` →
    // `drilldown` is a distance of 1, so without this the suggester proposes
    // the rename and the author writes a config object into a boolean slot.
    const r = ReportSchema.safeParse({
      name: 'r_one', label: 'R', type: 'summary', dataset: 'ds',
      drillDown: { target: 'dialog' },
    });
    expect(r.success).toBe(false);
    const msg = JSON.stringify(r.error?.issues ?? []);
    expect(msg).toContain('ObjectChart');
    expect(msg, 'names the type difference in this direction too').toContain('BOOLEAN');
    expect(msg, 'and the rename suggestion must NOT be what the author sees').not.toContain('`drillDown` → `drilldown`');
  });

  // ---- the carrier verdict, pinned ---------------------------------------
  it('is NOT a member of ChartConfigSchema — the dashboard path would not deliver it', () => {
    // The whole point of the #5022 placement. `ChartConfigSchema` is what a
    // dashboard widget's `chartConfig` parses, and objectui's DatasetWidget
    // forwards exactly one key out of it (`showLegend`). A member here would be
    // authorable, parse clean, and never reach a renderer.
    const shape = Object.keys(
      (ChartConfigSchema as unknown as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape,
    );
    expect(shape).not.toContain('drillDown');
  });

  it('is NOT a dashboard widget key either, and the widget says why', () => {
    const dash = getMetadataTypeSchema('dashboard');
    const widget = (extra: Record<string, unknown>) => ({
      name: 'dash_one', label: 'D',
      widgets: [{ id: 'w1', type: 'bar', title: 'W', dataset: 'ds', dimensions: ['a'], values: ['b'], ...extra }],
    });
    expect(dash!.safeParse(widget({})).success, 'control').toBe(true);
    const r = dash!.safeParse(widget({ drillDown: { enabled: true } }));
    expect(r.success).toBe(false);
    const msg = JSON.stringify(r.error?.issues ?? []);
    expect(msg, 'the capability is automatic, not missing').toContain('AUTOMATIC');
    expect(msg, 'and names where each configurable drill lives').toContain('ChartDrillDownSchema');
    expect(msg).toContain('ReportSchema.drilldown');
    // The lowercase spelling on a widget lands on the same prescription — an
    // author who half-remembers the report key must not get a bare
    // "unrecognized key" and conclude the feature is gone.
    expect(JSON.stringify(dash!.safeParse(widget({ drilldown: true })).error?.issues ?? [])).toContain('AUTOMATIC');
  });

  it('is published on the ObjectChart REACT block, and the type string matches the schema', () => {
    // `react-blocks.ts` publishes overlay props as hand-written type strings
    // (the ledger names that as a weakness). This is the pin that keeps the
    // string from becoming a second source of truth: every declared key must
    // appear in it, and no key it names may be undeclared.
    const chart = REACT_BLOCKS.find((b) => b.tag === 'ObjectChart')!;
    const drill = chart.interactions.find((i) => i.name === 'drillDown');
    expect(drill, 'the block must publish the prop at all').toBeTruthy();
    const shape = Object.keys(
      (ChartDrillDownSchema as unknown as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape,
    );
    for (const key of shape) {
      expect(drill!.type, `published type must name ${key}`).toContain(`${key}?:`);
    }
    // ...and nothing beyond the shape (the drift that matters — a type string
    // advertising `mode` while the schema rejects it).
    const named = [...drill!.type.matchAll(/(\w+)\?:/g)].map((m) => m[1]);
    expect(named.sort()).toEqual([...shape].sort());
  });

  it('is NOT published as a dataProp — that channel is the dashboard-shared schema', () => {
    // If a later change moves it into `ChartConfigSchema` and lists it here,
    // the dashboard surface silently gains an inert key. Two assertions, one
    // per half, so either half regressing is caught.
    const chart = REACT_BLOCKS.find((b) => b.tag === 'ObjectChart')!;
    expect(chart.dataProps ?? []).not.toContain('drillDown');
  });
});
