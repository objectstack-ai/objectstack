// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8894 — a dataset widget that queries a measure and never shows it
 * must SAY SO. It must not start rendering it.
 *
 * The query runs every measure the author declared (`measures: values`), and
 * the tile branch of `DatasetWidget` renders ONE of them. That drop used to be
 * silent: a tile answering a narrower question than its metadata asked, looking
 * like a finished product (ADR-0049 declared-but-unenforced). The diagnostic
 * pinned here keeps it audible.
 *
 * ## What changed since the first half of this card (PR objectui#8905)
 *
 * `@objectstack/spec` 17.5.0 narrowed `values` to ONE measure on the metric
 * family (ruling D on the card; objectui's `DashboardWidgetSchema` re-attaches
 * the spec's check). A metric tile with two measures is therefore refused at
 * every door, and reaches the renderer only as a document stored before the
 * narrowing. A dimensionless widget of a type the spec's text gives no
 * rendering of several measures (a `pie`, say) still passes every door and
 * still takes the tile, until the spec refuses that shape (objectstack#20958).
 *
 * So the diagnostic's condition is no longer "the widget is a metric tile with
 * more than one measure": it is "a declared measure is not rendered", the set
 * difference between `values` and what the chosen branch renders
 * (`renderedMeasures` in the component). Its text names the dropped measures
 * and points to the spec's replacement — the ADR-0087 entry of the
 * metric-family refusal — and names no widget types and gives no advice of its
 * own. The pins for that are the four triage set on the card, spread over this
 * file and `DatasetWidget.dimensionlessMeasures-11261.test.tsx` (where the
 * dimensionless `column` / `horizontal-bar` rows draw every measure):
 *
 *   - a dimensionless `pie` with two measures warns and names the dropped one;
 *   - a stored two-measure `metric` warns;
 *   - a dimensionless `table` does not warn (the control);
 *   - a dimensionless `horizontal-bar` renders three measures with no warning
 *     (in the 11261 file, beside the other dimensionless charts).
 *
 * ⛔ Still not done here, on purpose: rendering `values[1..]` on a tile.
 * objectui#8887 pins the drop itself and the byte-identity of a tile that
 * declares no sub-caption; both stay green, and the DOM control at the bottom of
 * this file measures the same thing from this card's side.
 *
 * Subjects vs controls: every `SUBJECT` asserts something a broken diagnostic
 * fails — silenced, or saying something false — and every `CONTROL` is green
 * either way and is here to catch a change that overshoots into noise or into
 * rendering what it should only report.
 *
 * No `dist/` is involved: the root `vitest.config.mts` aliases every
 * `@object-ui/*` specifier to that package's `src/`, and this file imports
 * `../DatasetWidget` relatively, so an ablation of the diagnostic reads source
 * directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MIGRATIONS_BY_MAJOR } from '@objectstack/spec/migrations';
import { ChartTypeSchema as SpecChartTypeSchema } from '@objectstack/spec/ui';
import { DashboardWidgetSchema } from '@object-ui/types/zod';
import { DatasetWidget } from '../DatasetWidget';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warn.mockRestore();
});

/** Every `console.warn` argument this render produced, flattened to one string. */
const warnings = (): string[] => warn.mock.calls.map((c: unknown[]) => c.join(' '));

/**
 * The one diagnostic this card is about, or `undefined`. Keyed on the phrase
 * the diagnostic keeps on purpose (see the first SUBJECT), so a control that
 * expects silence cannot pass by matching nothing after a rewording.
 */
const measureWarning = (): string | undefined =>
  warnings().find((m: string) => m.startsWith('[DatasetWidget]') && m.includes('Queried and then never displayed'));

const source = (rows: Record<string, unknown>[]) => ({
  queryDataset: vi.fn(async () => ({ rows })),
});

/** The ADR-0087 entry the diagnostic points to, as the message spells it. */
const ENTRY_ID = 'dashboard-widget-metric-family-multi-measure-refused';

type SemanticEntry = { id: string; replacement: string };
type MigrationRegistry = Readonly<Record<number, { semantic: readonly SemanticEntry[] }>>;

/**
 * The installed spec's ADR-0087 registry, read off the `./migrations` subpath.
 * Through 17.5.0 the chain was exported from the package ROOT and this file
 * read it there dynamically, so it would compile against both that and
 * objectstack `main`, which had moved it (its `migrations-entry-split` entry:
 * same names, new path). `@objectstack/spec` 17.6.0 carries the split and its
 * root no longer exports the registry, so the bump that moved the pin past it
 * (objectui#11438) replaced the dynamic root read with this static import, as
 * the previous docblock asked. ⛔ No fallback to the root.
 */
function installedMigrationRegistry(): MigrationRegistry {
  return MIGRATIONS_BY_MAJOR;
}

/** The duly#109 tile, verbatim from the card's repro block — a stored three-measure metric. */
const THREE_MEASURE_TILE = {
  id: 'list_completeness',
  type: 'metric',
  dataset: 'duly_duty_register',
  values: ['approved_rate', 'duties_to_confirm', 'duties_to_review'],
};

const renderTile = async (
  widget: Record<string, unknown>,
  rows: Record<string, unknown>[],
  awaitText: string,
) => {
  const { container } = render(<DatasetWidget widget={widget} dataSource={source(rows)} />);
  await screen.findByText(awaitText);
  return container;
};

describe('objectui#8894 — the dropped measures speak', () => {
  it('SUBJECT: names every measure it queried and will not display', async () => {
    await renderTile(
      THREE_MEASURE_TILE,
      [{ approved_rate: 82, duties_to_confirm: 7, duties_to_review: 3 }],
      '82',
    );
    const msg = measureWarning();
    expect(msg).toBeDefined();
    // Both dropped measures, by name — a message that named only the count
    // would not tell an author which declarations are not shown.
    expect(msg).toContain('Queried and then never displayed: "duties_to_confirm", "duties_to_review".');
    // ⚠️ The wording is load-bearing, not decoration. The extra measures are
    // NOT inert: the server computes them, they join the widget's refetch
    // signature, and `options.sortBy` accepts any of them. A message claiming
    // they are "ignored" or "unused" would be a second false statement layered
    // on the first, so what it claims is exactly what is true — they are
    // queried, and then never displayed.
    expect(msg).not.toMatch(/\bignored\b|\bunused\b|\bno effect\b/i);
  });

  it('SUBJECT: identifies the widget, and the measure it DOES render', async () => {
    await renderTile(
      THREE_MEASURE_TILE,
      [{ approved_rate: 82, duties_to_confirm: 7, duties_to_review: 3 }],
      '82',
    );
    // A dashboard mounts many tiles into one console. Without the widget id,
    // the dataset and what it renders, the reader cannot tell WHICH tile is
    // answering a narrower question than it was asked.
    expect(measureWarning()).toContain(
      '[DatasetWidget] Widget "list_completeness" (type "metric", dataset "duly_duty_register") '
      + 'renders 1 of its 3 declared measures: "approved_rate".',
    );
  });

  it('SUBJECT: points to the spec\'s replacement — an ADR-0087 entry the installed spec really carries', async () => {
    await renderTile(
      THREE_MEASURE_TILE,
      [{ approved_rate: 82, duties_to_confirm: 7, duties_to_review: 3 }],
      '82',
    );
    const msg = measureWarning()!;
    expect(msg).toContain(`ADR-0087 entry "${ENTRY_ID}"`);
    // The pointer cannot dangle: the id is read back out of the installed
    // spec's migration registry, and the entry carries the `replacement` the
    // message sends the reader to.
    const registry = installedMigrationRegistry();
    const entry = Object.values(registry)
      .flatMap((step) => step.semantic)
      .find((e) => e.id === ENTRY_ID);
    expect(entry, `${ENTRY_ID} is not in the installed spec's ADR-0087 registry`).toBeDefined();
    expect(entry!.replacement).toEqual(expect.any(String));
  });

  it('SUBJECT: names no widget types and gives no advice of its own — the entry is the advice', async () => {
    await renderTile(
      { id: 'bare_pie', type: 'pie', dataset: 'sales', values: ['revenue', 'cost'] },
      [{ revenue: 510000, cost: 120000 }],
      '510000',
    );
    const msg = measureWarning()!;
    expect(msg).toBeDefined();
    // Every spec widget type other than the widget's own, read off the spec's
    // enum so a type added later is covered. The entry id is removed first: it
    // is a name, and it happens to contain the word `metric`.
    const prose = msg.replace(`(type "pie",`, '').replace(ENTRY_ID, '');
    const named = SpecChartTypeSchema.options.filter((t: string) =>
      new RegExp(`(^|[^\\w-])${t.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(prose),
    );
    expect(named).toEqual([]);
    // The message the first half of this card shipped advised authors itself
    // ("Declare one measure per metric tile, or use a widget that renders every
    // measure (table, pivot or a chart)") — wrong on this arm, and a second copy
    // of the spec's replacement. Neither survives.
    expect(msg).not.toMatch(/\bDeclare\b|\buse a\b|\bchart\b/);
  });

  it('SUBJECT: speaks about the DECLARATION, so a failed query does not mute it', async () => {
    // No `queryDataset` on the source → the widget renders its error state and
    // never reaches the tile branch. What the branch would render is settled by
    // the declaration alone, and an author debugging a broken tile is exactly
    // who needs to hear this.
    render(<DatasetWidget widget={THREE_MEASURE_TILE} dataSource={{}} />);
    await screen.findByRole('alert');
    expect(measureWarning()).toBeDefined();
  });

  it('SUBJECT (triage pin): a STORED dimensionless pie with two measures warns and names the dropped one', async () => {
    // A widget that declares no dimension renders as a tile on a type the
    // spec's text gives no dimensionless rendering of, and drops the same
    // measures. Since `@objectstack/spec` 17.7.0 the spec refuses the shape and
    // objectui's door follows it (`checkDashboardWidgetChartMeasureArity`,
    // objectui#11717), so — as for the stored metric below — it reaches the
    // renderer only as a row stored before that narrowing, and the diagnostic
    // is what speaks at the dashboard. This line asserted the acceptance until
    // the mirror attached; it flipped on purpose.
    const doc = { id: 'bare_pie', type: 'pie', dataset: 'sales', values: ['revenue', 'cost'] };
    expect(DashboardWidgetSchema.safeParse(doc).success, 'the door refuses it — only a stored row reaches the renderer').toBe(false);
    await renderTile(doc, [{ revenue: 510000, cost: 120000 }], '510000');
    const msg = measureWarning();
    expect(msg).toContain('renders 1 of its 2 declared measures: "revenue".');
    expect(msg).toContain('Queried and then never displayed: "cost".');
  });

  it('SUBJECT (triage pin): a STORED two-measure metric warns', async () => {
    // The door refuses this document since spec 17.5.0, so it reaches the
    // renderer only as a row stored before that narrowing: the read path serves
    // stored rows as they are. The diagnostic is what speaks at the dashboard.
    const doc = { id: 'rev_cost', type: 'metric', dataset: 'sales', values: ['revenue', 'cost'] };
    const door = DashboardWidgetSchema.safeParse(doc);
    expect(door.success, 'the door refuses it — only a stored row reaches the renderer').toBe(false);
    await renderTile(doc, [{ revenue: 510000, cost: 120000 }], '510000');
    expect(measureWarning()).toContain('Queried and then never displayed: "cost".');
  });

  it('SUBJECT: covers the metric-TYPE-with-dimensions arm', async () => {
    // The other half of `isMetric`: a declared `metric` KEEPS tile shape even
    // with dimensions, renders `rows[0]` only, and still drops measure 2.
    await renderTile(
      { id: 'by_status', type: 'metric', dataset: 'sales', dimensions: ['status'], values: ['revenue', 'cost'] },
      [{ status: 'won', revenue: 510000, cost: 120000 }],
      '510000',
    );
    expect(measureWarning()).toContain('"cost"');
  });

  it('CONTROL (triage pin): a dimensionless table renders every measure and stays silent', async () => {
    // objectui#11261 gave a dimensionless table one row of every measure, so
    // nothing is dropped and the set difference is empty. The signal must be
    // about the drop, not about the measure count or the absent dimension.
    render(
      <DatasetWidget
        widget={{ id: 'totals', type: 'table', dataset: 'sales', values: ['revenue', 'cost', 'margin'] }}
        dataSource={source([{ revenue: 510000, cost: 120000, margin: 390000 }])}
      />,
    );
    await screen.findByText('390000');
    expect(measureWarning()).toBeUndefined();
  });

  it('CONTROL (green before and after): a single-measure tile stays silent', async () => {
    // The overwhelming majority of authored metric tiles. If this went red,
    // the diagnostic would be shouting at every dashboard in the fleet.
    await renderTile({ id: 'rev', type: 'metric', dataset: 'sales', values: ['revenue'] }, [{ revenue: 510000 }], '510000');
    expect(measureWarning()).toBeUndefined();
  });

  it('CONTROL (green before and after): a chart that renders every measure stays silent', async () => {
    // Same three measures, but with a dimension and a charting type: every
    // measure is handed on as a series, so there is nothing to say.
    render(
      <DatasetWidget
        widget={{ id: 'trend', type: 'bar', dataset: 'sales', dimensions: ['month'], values: ['revenue', 'cost', 'margin'] }}
        dataSource={source([{ month: '2026-01', revenue: 510000, cost: 120000, margin: 390000 }])}
      />,
    );
    // The chart itself is a test-env stub, so settle on the loading state
    // clearing rather than on any painted mark.
    await waitFor(() => expect(screen.queryByTestId('dataset-loading')).toBeNull());
    expect(measureWarning()).toBeUndefined();
  });

  it('CONTROL (green before and after): the tile\'s markup is untouched — reported, not rendered', async () => {
    // Making the drop audible must not make it visible. Byte-for-byte, a
    // three-measure tile still renders exactly one number and one caption —
    // the same markup `DatasetWidget.subCaption.test.tsx` and
    // `DatasetWidget.colorVariant.test.tsx` pin for a one-measure tile.
    const container = await renderTile(
      THREE_MEASURE_TILE,
      [{ approved_rate: 82, duties_to_confirm: 7, duties_to_review: 3 }],
      '82',
    );
    expect(container.innerHTML).toBe(
      '<div class="flex h-full w-full flex-col items-start justify-center gap-1 p-2">'
      + '<span class="text-2xl font-semibold tabular-nums">82</span>'
      + '<span class="text-xs text-muted-foreground">approved_rate</span>'
      + '</div>',
    );
  });
});
