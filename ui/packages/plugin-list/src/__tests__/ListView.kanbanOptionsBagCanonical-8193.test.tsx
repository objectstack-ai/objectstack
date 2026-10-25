/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8193 — the kanban capability gate asked the `options` bag for the
 * LEGACY lane spelling only.
 *
 * `availableViews` resolved kanban from three rungs: `schema.kanban`'s two
 * spellings, and `schema.options.kanban.groupField`. There was no canonical
 * rung for the bag — so a producer writing the SPEC key into `options.kanban`
 * was invisible to the gate while rendering perfectly, because the render
 * branch merges the bag and resolves `groupByField || groupField`. The gate
 * recognized strictly LESS than what renders.
 *
 * ⚠️ THIS WAS LATENT UNTIL objectui#8193 MADE IT REACHABLE, which is why it is
 * fixed alongside a producer change rather than on its own card. `app-shell`'s
 * `ObjectView` writes the view-level kanban config into `options.kanban`, and
 * it had always written the legacy `groupField` — so the missing rung cost
 * nothing. Moving that producer onto the canonical key (the actual subject of
 * objectui#8193) turned the hole into a regression: measured before and after,
 * a bag of `{groupBy, groupField}` offered Kanban and `{groupBy, groupByField}`
 * did not. The toggle would have disappeared from every object view in the
 * product, silently, with the board still rendering correctly if you reached it
 * another way.
 *
 * SAME SHAPE, THIRD TIME: objectui#5042 (`map`) and objectui#7544 (`chart`)
 * were both "the gate and the seam must answer one question", and both were
 * fixed by making the gate ask what the render branch asks. Kanban's render
 * branch resolves `groupByField || groupField` off the MERGED config, so the
 * gate now recognizes the same four combinations that merge.
 *
 * ⛔ NO ALIAS READ WAS REMOVED by this card: it added the canonical rung the
 * bag never had. The alias rungs went later, on their own ruling (objectui#6152
 * round 14); the legacy-bag CONTROL below was re-judged into a refusal arm then.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * drop the `schema.options?.kanban?.groupByField` rung and the canonical-bag
 * arms below go RED while every legacy-bag and declared-path CONTROL stays
 * GREEN — the gate keeps answering correctly for every input it already
 * handled. That asymmetry is the point: a "fix" that pushed `kanban` whenever
 * it was whitelisted would also pass the positive arms, so the refusal arms at
 * the bottom are load-bearing.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'deal', fields: {} }),
});

// `viewType: 'grid'` on purpose: the gate has an "always allow switching back
// to the schema's own viewType" rung, so a kanban-typed view would resolve
// kanban for a reason that has nothing to do with the binding under test.
const BASE = {
  type: 'list-view',
  objectName: 'deal',
  viewType: 'grid',
  columns: ['name'],
} as const;

const renderSwitcher = (view: Record<string, unknown>) => {
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, ...view } as never} dataSource={dataSource} showViewSwitcher />
    </SchemaRendererProvider>,
  );
  const trigger = screen.queryByTestId('view-switcher-dropdown');
  if (trigger) fireEvent.click(trigger);
};

/** Mirrors the helper in `ListView.chart-capability-7544.test.tsx`. */
const queryViewOption = (name: string) =>
  screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

/** Is `kanban` offered for a view whitelisting exactly `['grid', 'kanban']`? */
const kanbanOffered = (view: Record<string, unknown>) => {
  renderSwitcher({ appearance: { allowedVisualizations: ['grid', 'kanban'] }, ...view });
  return Boolean(queryViewOption('Kanban'));
};

describe('the capability gate resolves kanban from the CANONICAL key in the options bag (objectui#8193)', () => {
  // THE DISCRIMINATING ARM. This read `false` before the fix — and it is
  // exactly the bag `app-shell`'s ObjectView now emits.
  it('offers Kanban for `options.kanban.groupByField`', () => {
    expect(kanbanOffered({ options: { kanban: { groupByField: 'stage' } } })).toBe(true);
  });

  it('offers Kanban for the bag ObjectView actually writes', () => {
    // The end-to-end shape. ⚠️ This fixture used to carry `groupBy` and call
    // itself "the producer's real output"; objectui#8213 retired that write, so
    // the producer claim lives here and the `groupBy`-bearing bag moved to the
    // arm below, as what it always really was — a robustness arm.
    // ⛔ One `kanbanOffered` per test: it renders into the shared screen, and a
    // second render in the same test makes every `queryByRole` ambiguous.
    expect(
      kanbanOffered({ options: { kanban: { groupByField: 'stage', titleField: 'name' } } }),
    ).toBe(true);
  });

  it('CONTROL: a bag that ALSO carries a stray `groupBy` is answered the same', () => {
    // Stored metadata written before objectui#8213 still carries the key, and
    // this repo's `KanbanConfig` mirror is `.passthrough()`, so the gate must
    // keep answering identically for a bag that has it and one that does not.
    expect(
      kanbanOffered({
        options: { kanban: { groupBy: 'stage', groupByField: 'stage', titleField: 'name' } },
      }),
    ).toBe(true);
  });

  it('does NOT offer Kanban for the retired LEGACY `options.kanban.groupField` (objectui#6152 round 14)', () => {
    // This card's CONTROL here proved the fix ADDED a rung rather than swapping
    // one out. Round 14 retired the alias rung: a stored bag `groupField` names
    // no lane, so the gate must not offer a board for it.
    expect(kanbanOffered({ options: { kanban: { groupField: 'stage' } } })).toBe(false);
  });

  it('CONTROL: still offers Kanban for the declared `kanban.groupByField`', () => {
    expect(kanbanOffered({ kanban: { groupByField: 'stage' } })).toBe(true);
  });

  it('does NOT offer Kanban for the retired declared-path `kanban.groupField` (objectui#6152 round 14)', () => {
    // It did while `normalizeListViewSchema` folded a TOP-LEVEL alias onto
    // `groupByField` before the gate read anything; round 14 retired that fold.
    expect(kanbanOffered({ kanban: { groupField: 'stage' } })).toBe(false);
  });

  // THE OTHER HALF. Pinning only the arms above would let the fix degrade into
  // "offer kanban whenever whitelisted", which is worse than the bug: a board
  // with no lane binding renders every card into one implicit column.
  it('does NOT offer Kanban with no kanban block anywhere', () => {
    expect(kanbanOffered({})).toBe(false);
  });

  it('does NOT offer Kanban for an options bag carrying no lane key', () => {
    expect(kanbanOffered({ options: { kanban: { titleField: 'name' } } })).toBe(false);
  });

  it('does NOT offer Kanban for an empty declared block', () => {
    expect(kanbanOffered({ kanban: {} })).toBe(false);
  });

  it('does NOT offer Kanban for `groupBy` alone', () => {
    // `groupBy` is not a lane binding the gate recognizes in any nesting, and
    // objectui#8213 measured that the spec does not declare it either. Pinned
    // so the new canonical rung is not quietly widened into a third spelling.
    expect(kanbanOffered({ options: { kanban: { groupBy: 'stage' } } })).toBe(false);
  });
});
