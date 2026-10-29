// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27347 — an inline `object-metric` tile colours its trend badge by
 * its declared `polarity`.
 *
 * The dataset-bound tile has coloured its delta by the measure's `polarity`
 * since objectstack#26602, but a page-level `object-metric` node aggregates a
 * field, not a dataset measure, so it coloured by direction alone: an average
 * turnaround that rose 20% was drawn green. The node now declares `polarity`
 * itself, in the measure's vocabulary, and `MetricWidget` colours the badge it
 * draws (`derivedTrend ?? trend`) by the one shared rule, `deltaToneClass`:
 *   - `lower`: a rise is red, a fall is green;
 *   - `neutral`: no good/bad colour, the muted text colour;
 *   - `higher`: a rise is green, a fall is red;
 *   - undeclared: exactly today's class string, with no guess from the field's
 *     name — the fixture aggregates a field literally named `turnaround_days`.
 *
 * The arrow is the number's direction under every polarity. The `compareTo`
 * rows mount the REGISTERED block through `SchemaRenderer` (its
 * `ElementDataSourceGate` shell forwards every authored key but `objectName`
 * and `filter` untouched), so the pin covers the path an author reaches. The
 * static `trend` badge is the same badge, so one top-level key covers it too.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-metric` at MODULE scope, never inside a hook
// (object-ui/no-dynamic-import-in-test-hook).
import '../index';

afterEach(cleanup);

const GOOD = /text-emerald-600/;
const BAD = /text-rose-600/;
const MUTED = /text-muted-foreground/;

type Polarity = 'higher' | 'lower' | 'neutral' | undefined;

const quarterStart = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CURRENT_FROM = iso(quarterStart(new Date()));

/** The current window answers `current`; every shifted window answers `previous`. */
const comparingAdapter = (current: number, previous: number) => ({
  aggregate: vi.fn(async (_object: string, q: { filter?: { submitted_on?: { $gte?: string } } }) => [
    { turnaround_days_avg: String(q?.filter?.submitted_on?.$gte) === CURRENT_FROM ? current : previous },
  ]),
});

const mount = (schema: Record<string, unknown>, adapter?: unknown) =>
  render(
    <SchemaRendererProvider dataSource={adapter as never}>
      <SchemaRenderer
        schema={{ type: 'object-metric', objectName: 'approval', label: 'Avg. turnaround', ...schema } as never}
      />
    </SchemaRendererProvider>,
  );

/** The `compareTo`-derived badge of an `object-metric` node declaring `polarity`. */
async function derivedBadge(current: number, previous: number, polarity: Polarity) {
  mount(
    {
      aggregate: { field: 'turnaround_days', function: 'avg' },
      filter: { submitted_on: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } },
      compareTo: { kind: 'previousPeriod' },
      ...(polarity ? { polarity } : {}),
    },
    comparingAdapter(current, previous),
  );
  return screen.findByText('20%');
}

const arrow = (badge: HTMLElement) => badge.querySelector('svg')?.getAttribute('class') ?? '';

describe('object-metric — trend badge colour by declared `polarity` (objectstack#27347)', () => {
  it('lower: a rise is drawn bad, with the up arrow kept', async () => {
    const badge = await derivedBadge(120, 100, 'lower');
    expect(badge.className).toMatch(BAD);
    expect(badge.className).not.toMatch(GOOD);
    expect(arrow(badge)).toMatch(/arrow-up/);
  });

  it('lower: a fall is drawn good, with the down arrow kept', async () => {
    const badge = await derivedBadge(80, 100, 'lower');
    expect(badge.className).toMatch(GOOD);
    expect(badge.className).not.toMatch(BAD);
    expect(arrow(badge)).toMatch(/arrow-down/);
  });

  it('higher: a rise is drawn good, as before', async () => {
    const badge = await derivedBadge(120, 100, 'higher');
    expect(badge.className).toMatch(GOOD);
    expect(badge.className).not.toMatch(BAD);
  });

  it('neutral: neither a rise nor a fall takes a good/bad colour', async () => {
    for (const [current, direction] of [[120, /arrow-up/], [80, /arrow-down/]] as const) {
      const badge = await derivedBadge(current, 100, 'neutral');
      expect(badge.className).not.toMatch(GOOD);
      expect(badge.className).not.toMatch(BAD);
      expect(badge.className).toMatch(MUTED);
      expect(arrow(badge)).toMatch(direction);
      cleanup();
    }
  });

  it('CONTROL — undeclared draws today\'s class string byte for byte, never guessed from the field name', async () => {
    const rise = await derivedBadge(120, 100, undefined);
    expect(rise.className).toBe('flex items-center shrink-0 font-medium text-emerald-600 dark:text-emerald-400');
    cleanup();
    const fall = await derivedBadge(80, 100, undefined);
    expect(fall.className).toBe('flex items-center shrink-0 font-medium text-rose-600 dark:text-rose-400');
  });

  it('colours the static `trend` badge by the same key', () => {
    mount({ fallbackValue: 4.2, trend: { value: 12, direction: 'up' }, polarity: 'lower' });
    const badge = screen.getByText('12%');
    expect(badge.className).toMatch(BAD);
    expect(arrow(badge)).toMatch(/arrow-up/);
  });

  it('CONTROL — a static badge with no `direction` takes no tone under any polarity', () => {
    mount({ fallbackValue: 4.2, trend: { value: 12 }, polarity: 'lower' });
    const badge = screen.getByText('12%');
    expect(badge.className).toBe('flex items-center shrink-0 font-medium');
  });
});
