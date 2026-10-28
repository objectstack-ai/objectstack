// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26602 — a period-over-period delta is coloured by the measure's
 * declared polarity.
 *
 * hotclm's "average approval turnaround" tile drew "↑ 23% vs previous period"
 * in green for a turnaround that got 23% longer: the tile coloured every rise
 * green. The dataset measure now declares `polarity`, the server relays it on
 * the measure column's descriptor (`fields[].polarity`), and the delta's colour
 * follows it:
 *   - `lower`: a rise is red, a fall is green;
 *   - `neutral`: no good/bad colour, the muted text colour;
 *   - `higher`: a rise is green, a fall is red;
 *   - undeclared: exactly today's colours (a rise green, a fall red), with no
 *     guess from the measure's name — the fixture's measure is literally named
 *     `turnaround_days`, and still reads as `higher` when it declares nothing.
 *
 * The arrow is the number's direction under every polarity. Both surfaces that
 * colour a delta are pinned: the metric tile and the cross-tab cell.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { DatasetWidget } from '../DatasetWidget';

afterEach(cleanup);

const Q2 = { submitted_on: { $gte: '2026-04-01', $lte: '2026-06-30' } };
const GOOD = /text-emerald-600/;
const BAD = /text-rose-600/;

type Polarity = 'higher' | 'lower' | 'neutral' | undefined;

const field = (polarity: Polarity) => ({
  name: 'turnaround_days', type: 'number', label: 'Avg. turnaround',
  ...(polarity ? { polarity } : {}),
});

/** The tile's delta badge, for a current/previous pair over a measure of `polarity`. */
async function tileBadge(current: number, previous: number, polarity: Polarity) {
  render(
    <DatasetWidget
      widget={{
        type: 'metric', dataset: 'approvals', values: ['turnaround_days'],
        filter: { ...Q2 }, compareTo: { kind: 'previousPeriod' },
      }}
      dataSource={{
        queryDataset: vi.fn(async () => ({
          rows: [{ turnaround_days: current, turnaround_days__compare: previous }],
          fields: [field(polarity), { ...field(polarity), name: 'turnaround_days__compare' }],
        })),
      }}
    />,
  );
  return (await screen.findByTestId('dataset-compare-trend')).firstElementChild as HTMLElement;
}

const arrow = (badge: HTMLElement) => badge.querySelector('svg')?.getAttribute('class') ?? '';

describe('DatasetWidget metric tile — delta colour by declared polarity (objectstack#26602)', () => {
  it('lower: a rise is drawn bad, with the up arrow kept', async () => {
    const badge = await tileBadge(123, 100, 'lower');
    expect(badge.textContent).toBe('23%');
    expect(badge.className).toMatch(BAD);
    expect(badge.className).not.toMatch(GOOD);
    expect(arrow(badge)).toMatch(/arrow-up/);
  });

  it('lower: a fall is drawn good, with the down arrow kept', async () => {
    const badge = await tileBadge(80, 100, 'lower');
    expect(badge.className).toMatch(GOOD);
    expect(badge.className).not.toMatch(BAD);
    expect(arrow(badge)).toMatch(/arrow-down/);
  });

  it('neutral: neither a rise nor a fall takes a good/bad colour', async () => {
    for (const [current, direction] of [[123, /arrow-up/], [80, /arrow-down/]] as const) {
      const badge = await tileBadge(current, 100, 'neutral');
      expect(badge.className).not.toMatch(GOOD);
      expect(badge.className).not.toMatch(BAD);
      expect(badge.className).toMatch(/text-muted-foreground/);
      expect(arrow(badge)).toMatch(direction);
      cleanup();
    }
  });

  it('higher: a rise is good and a fall is bad', async () => {
    expect((await tileBadge(123, 100, 'higher')).className).toMatch(GOOD);
    cleanup();
    expect((await tileBadge(80, 100, 'higher')).className).toMatch(BAD);
  });

  it('undeclared: today\'s colours exactly, whatever the measure is named', async () => {
    const up = await tileBadge(123, 100, undefined);
    expect(up.className).toBe('flex shrink-0 items-center font-medium text-emerald-600 dark:text-emerald-400');
    cleanup();
    const down = await tileBadge(80, 100, undefined);
    expect(down.className).toBe('flex shrink-0 items-center font-medium text-rose-600 dark:text-rose-400');
  });

  it('a flat delta stays muted under every polarity', async () => {
    for (const polarity of ['higher', 'lower', 'neutral', undefined] as const) {
      const badge = await tileBadge(100, 100, polarity);
      expect(badge.textContent).toBe('0%');
      expect(badge.className, String(polarity)).toBe('flex shrink-0 items-center font-medium text-muted-foreground');
      cleanup();
    }
  });
});

describe('DatasetWidget cross-tab cell — delta colour by declared polarity (objectstack#26602)', () => {
  async function cellBadges(polarity: Polarity) {
    render(
      <DatasetWidget
        widget={{
          type: 'pivot', dataset: 'approvals', dimensions: ['team', 'kind'], values: ['turnaround_days'],
          filter: { ...Q2 }, title: 'Turnaround', compareTo: { kind: 'previousYear' },
        }}
        dataSource={{
          queryDataset: vi.fn(async () => ({
            rows: [
              { team: 'Legal', kind: 'NDA', turnaround_days: 12, turnaround_days__compare: 10 },
              { team: 'Legal', kind: 'MSA', turnaround_days: 8, turnaround_days__compare: 10 },
            ],
            fields: [
              { name: 'team', type: 'string', label: 'Team' },
              { name: 'kind', type: 'string', label: 'Kind' },
              field(polarity),
              { ...field(polarity), name: 'turnaround_days__compare' },
            ],
          })),
        }}
      />,
    );
    const m = await screen.findByTestId('dataset-matrix');
    const stacks = within(m).getAllByTestId('matrix-cell-compare');
    const byDirection = (d: string) =>
      stacks.filter((s) => s.getAttribute('data-direction') === d).map((s) => s.lastElementChild as HTMLElement);
    return { up: byDirection('up'), down: byDirection('down') };
  }

  it('lower: the rising cell is bad and the falling cell is good', async () => {
    const { up, down } = await cellBadges('lower');
    expect(up.length).toBeGreaterThan(0);
    expect(down.length).toBeGreaterThan(0);
    for (const b of up) expect(b.className).toMatch(BAD);
    for (const b of down) expect(b.className).toMatch(GOOD);
  });

  it('neutral: no cell takes a good/bad colour', async () => {
    const { up, down } = await cellBadges('neutral');
    for (const b of [...up, ...down]) {
      expect(b.className).not.toMatch(GOOD);
      expect(b.className).not.toMatch(BAD);
    }
  });

  it('undeclared: a rise green and a fall red, as before', async () => {
    const { up, down } = await cellBadges(undefined);
    for (const b of up) expect(b.className).toMatch(GOOD);
    for (const b of down) expect(b.className).toMatch(BAD);
  });
});
