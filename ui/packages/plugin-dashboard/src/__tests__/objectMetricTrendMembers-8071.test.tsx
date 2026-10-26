/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-metric.trend` — the MEMBER SHAPE of the static trend badge
 * (objectui#8071).
 *
 * The member pin for the first of the two PRESENTATION keys objectui#8071's
 * ninth slice takes. Slice 8 pinned the four members that shape the aggregate
 * query behind the NUMBER (`dataSource`, `aggregate`, `filter`, `compareTo`);
 * these two shape what is drawn AROUND the number once it exists, and neither
 * reaches `fetchMetric` / `computeOne`.
 *
 * Asserted through the REGISTERED block (`type: 'object-metric'` mounted by
 * `SchemaRenderer`, registered by this package's own side-effect import) rather
 * than on `ObjectMetricWidget` directly, so the pin covers the path an author
 * actually reaches: the block's `ElementDataSourceGate` shell re-binds only
 * `objectName` and `filter` and forwards every other authored key untouched.
 *
 * ## The member set, and where each member is read
 *
 * The registration declares `trend` as `{ value, label, direction }`. Two
 * different components read it, and that split is the member shape:
 *
 *   - `ObjectMetricWidget` forwards the key untouched beside its own
 *     host-only `derivedTrend`; `MetricWidget` decides whether the authored
 *     one survives at all — `derivedTrend ?? trend` (objectui#12677).
 *   - `MetricWidget` reads the three members: `value` painted with a hard-coded
 *     `%` suffix, `direction` choosing the glyph and its colour, and `label`
 *     feeding the caption slot.
 *
 * Each member is pinned on an observable only that member can move, and the
 * three `direction` values are pinned as a SET with the omitted-`direction`
 * arm as their control — without it, "renders an up arrow" would also pass on
 * a renderer that painted an up arrow unconditionally.
 *
 * ## The two rows with real semantics to get wrong
 *
 *   - **`description` OUTRANKS `trend.label`.** `MetricWidget` resolves one
 *     caption for the whole badge row: `pickLocalized(description) ||
 *     pickLocalized(trend?.label)`. A tile that authors both silently drops the
 *     trend caption. That is a member semantic, not a layout detail: an author
 *     who adds a `description` to an existing tile loses the trend's own words
 *     with no diagnostic, and nothing else in the repo says so.
 *   - **`compareTo` OVERRIDES a static `trend` outright.** `derivedTrend ??
 *     trend` means a computed comparison does not merge with the authored badge
 *     — it replaces it, value, direction and caption together. The registration
 *     text tells authors to use one or the other ("Use `compareTo` instead when
 *     the trend should be computed from data"); this file is what makes that
 *     sentence true. The override row and its no-`compareTo` control run on the
 *     SAME schema so only the key under test varies: 120-vs-100 derives +20%
 *     up, and the authored badge says 99% down, so neither arm can pass by
 *     painting the other's numbers.
 *
 * ## LIMIT, stated rather than asserted
 *
 * `trend.value` is painted as `{value}%` — the `%` is hard-coded in
 * `MetricWidget`, so the member is a PERCENTAGE whatever the metric's own
 * `format` / `currency` / `suffix` say. That is pinned as the live reading; it
 * is not a claim that a non-percentage trend is expressible.
 *
 * ## Nothing pre-existing covered this key
 *
 * Measured before being decided, and each candidate read end to end rather than
 * dismissed on its greps. The repo's own locator (`memberPinProblem`) requires
 * a pin file to name BOTH the block and the key: exactly two collected files
 * name `object-metric` and `trend`, and neither could carry this pin.
 * `registry-inputs-spec-parity.test.ts` is the ledger itself.
 * `ObjectMetricWidget.compareTo.test.tsx` is already the `compareTo` pin and
 * never authors a `trend` prop at all — the word appears in its prose and in
 * one title ("shows no trend without compareTo", which asserts the absence of a
 * derived caption). Crediting it would have been slice 7's
 * `action-bodyShape-forward.test.tsx` mistake: the locator satisfied by a file
 * that says nothing about the key.
 *
 * `ObjectMetricWidget.i18nLabel.test.tsx` is the trap slice 8 flagged for this
 * slice, and the re-measurement corrects half of its description: the file
 * authors `trend={{ value, direction, label }}` twice, but it contains ZERO
 * occurrences of the string `object-metric` (control: `ObjectMetricWidget`
 * reads 15 in the same file), so it does NOT satisfy this repo's locator — only
 * a locator keyed on the key name alone. What it asserts is `I18nLabel`
 * resolution: that a map `trend.label` resolves to the active locale, and that
 * the props type accepts the map. It asserts nothing about `value`,
 * `direction`, the member set, or the two precedence rules above, so it is not
 * promoted here; its own subject is left intact.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-metric` (the `ObjectMetricBlock` shell under test) at
// MODULE scope, never inside a hook — object-ui/no-dynamic-import-in-test-hook.
import '../index';

afterEach(cleanup);

/** The adapter call signature the aggregate path uses: `(object, params)`. */
type Params = Record<string, unknown>;

/**
 * The comparison fixture, shaped exactly as `ObjectMetricWidget.compareTo`'s:
 * the CURRENT window answers 120 and every shifted window answers 100, so a
 * derived trend is +20% and `direction: 'up'`.
 */
const quarterStart = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CURRENT_FROM = iso(quarterStart(new Date()));

const comparingAdapter = () => ({
  aggregate: vi.fn(async (_object: string, q: Params) => [
    {
      amount_sum:
        String((q?.filter as Record<string, { $gte?: string }> | undefined)?.close_date?.$gte) ===
        CURRENT_FROM
          ? 120
          : 100,
    },
  ]),
});

const QUARTER_FILTER = {
  close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' },
};

const mount = (schema: Record<string, unknown>, adapter?: unknown) =>
  render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer schema={{ type: 'object-metric', label: 'Revenue', ...schema } as never} />
    </SchemaRendererProvider>,
  );

/** A static tile: no adapter, so the value is the authored fallback. */
const staticTile = (trend: unknown, rest: Record<string, unknown> = {}) =>
  mount({ objectName: 'deal', fallbackValue: 42, trend, ...rest });

/** The three glyphs `direction` chooses between, as a set. */
const GLYPHS = {
  up: 'svg.lucide-arrow-up',
  down: 'svg.lucide-arrow-down',
  neutral: 'svg.lucide-minus',
} as const;

/** Which of the three direction glyphs the tile is painting, as a sorted list. */
const glyphsIn = (root: HTMLElement): string[] =>
  (Object.keys(GLYPHS) as Array<keyof typeof GLYPHS>)
    .filter((name) => root.querySelector(GLYPHS[name]) !== null)
    .sort();

describe('object-metric — the `trend` member shape (objectui#8071)', () => {
  it('paints `value` as a PERCENTAGE, whatever the metric formats its own number as', () => {
    // `format`/`suffix` govern the NUMBER; the trend badge's `%` is its own.
    const { container } = staticTile({ value: 12, direction: 'up' }, {
      format: '$0,0',
      suffix: ' /mo',
    });
    expect(screen.getByText('12%')).toBeTruthy();
    expect(container.textContent).toContain('$42 /mo');
  });

  it('reads `direction: "up"` and no other glyph', () => {
    const { container } = staticTile({ value: 12, direction: 'up' });
    expect(glyphsIn(container)).toEqual(['up']);
  });

  it('reads `direction: "down"` and no other glyph', () => {
    const { container } = staticTile({ value: 12, direction: 'down' });
    expect(glyphsIn(container)).toEqual(['down']);
  });

  it('reads `direction: "neutral"` and no other glyph', () => {
    const { container } = staticTile({ value: 12, direction: 'neutral' });
    expect(glyphsIn(container)).toEqual(['neutral']);
  });

  it('with `direction` OMITTED still paints the value, and no glyph at all', () => {
    // The control for the three rows above: without it each of them would also
    // pass on a renderer that painted its glyph unconditionally.
    const { container } = staticTile({ value: 12 });
    expect(screen.getByText('12%')).toBeTruthy();
    expect(glyphsIn(container)).toEqual([]);
  });

  it('reads `label` into the badge caption', () => {
    staticTile({ value: 12, direction: 'up', label: 'Authored trend caption' });
    expect(screen.getByText('Authored trend caption')).toBeTruthy();
  });

  it('lets the tile-level `description` OUTRANK `trend.label`', () => {
    // One caption slot, resolved `description || trend.label`. A tile that
    // authors both loses the trend's own words silently.
    staticTile({ value: 12, direction: 'up', label: 'Authored trend caption' }, {
      description: 'Authored tile description',
    });
    expect(screen.getByText('Authored tile description')).toBeTruthy();
    expect(screen.queryByText('Authored trend caption')).toBeNull();
  });

  it('reads no member the registration does not declare', () => {
    // The whitelist direction: an off-list member must not reach the badge.
    const { container } = staticTile({
      value: 12,
      direction: 'up',
      label: 'Authored trend caption',
      percent: 99,
      caption: 'Off-list caption',
    });
    expect(container.textContent).not.toContain('99');
    expect(container.textContent).not.toContain('Off-list caption');
  });

  it('with NO `trend` and no `description` paints no badge at all', () => {
    // Non-vacuity floor for every row above: the badge row is gated on the key.
    const { container } = mount({ objectName: 'deal', fallbackValue: 42 });
    expect(glyphsIn(container)).toEqual([]);
    expect(container.textContent).not.toContain('%');
  });

  it('lets a `compareTo`-DERIVED trend replace the authored one outright', async () => {
    const adapter = comparingAdapter();
    const { container } = mount(
      {
        objectName: 'deal',
        aggregate: { field: 'amount', function: 'sum' },
        filter: QUARTER_FILTER,
        trend: { value: 99, direction: 'down', label: 'Authored trend caption' },
        compareTo: { kind: 'previousYear' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(2));

    // The derived badge, all three members: 120 vs 100 is +20% and up.
    expect(await screen.findByText('20%')).toBeTruthy();
    expect(await screen.findByText(/vs last year/i)).toBeTruthy();
    expect(glyphsIn(container)).toEqual(['up']);

    // And NOT a merge: every member of the authored badge is gone.
    expect(screen.queryByText('99%')).toBeNull();
    expect(screen.queryByText('Authored trend caption')).toBeNull();
  });

  it('keeps the authored trend when `compareTo` is absent — the override control', async () => {
    // Same schema, one key removed, so the row above cannot be read as the
    // authored badge simply never rendering.
    const adapter = comparingAdapter();
    const { container } = mount(
      {
        objectName: 'deal',
        aggregate: { field: 'amount', function: 'sum' },
        filter: QUARTER_FILTER,
        trend: { value: 99, direction: 'down', label: 'Authored trend caption' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('99%')).toBeTruthy();
    expect(screen.getByText('Authored trend caption')).toBeTruthy();
    expect(glyphsIn(container)).toEqual(['down']);
    expect(screen.queryByText('20%')).toBeNull();
  });
});
