/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-metric.drillDown` — the members that started ACTING when this block
 * stopped hand-rolling its drill panel (objectui#8970).
 *
 * `ObjectMetricWidget` used to build its own Sheet/Dialog panel inline. That
 * copy read `enabled`, `target`'s two in-place arms, `title` and `report`, and
 * had no read site at all for the rest of the `DrillDownConfig` the designer
 * inspector offers — so an author who moved a tile between `object-metric` and
 * any other block sharing that config lost behaviour with no diagnostic and no
 * rejection. Routing the block through the shared `DrillDownDrawer` gives three
 * of them a read site here for the first time:
 *
 *   - **`target: 'navigate'`** — the arm the contract describes as CONDITIONAL
 *     ("Requires a host that provides drill navigation … falls back to
 *     `'drawer'` when none is available"). The inline copy fell into its `else`
 *     branch and drew the sheet unconditionally, which reads as the documented
 *     behaviour while being a different one. Pinned in BOTH directions, because
 *     only the pair separates "the arm is read" from "the handler happens to be
 *     absent": with a host handler it navigates and draws nothing; without one
 *     it still draws the sheet.
 *   - **`columns`** — the drilled list's column whitelist.
 *   - **`maxRows`** — the drilled list's page size.
 *
 * ## Why each row asserts an EFFECT and not a forwarded prop
 *
 * Every assertion below reads something the drilled list DID: which handler
 * ran, how many column headers exist, how many body rows rendered. A test that
 * only checked that a drawer appears, or that a prop reached a mock, would have
 * passed against the hand-rolled panel too — it drew a drawer as well. Each row
 * carries its own control (the other `target` arm, the same drill without the
 * member) so a renderer that ignored the member cannot pass by accident.
 *
 * ## What is deliberately NOT asserted
 *
 * `filter` and `mode` still have no read site on this block, and this file does
 * not assert that they don't. objectui#8970 asks for a judgement on them —
 * a metric has no click event for `${event.*}` to resolve against, and its own
 * registration promises the drilled list agrees with the number, which an
 * author-supplied override would break — and an assertion that a member is dead
 * has to be deleted before that judgement can be acted on. The member pin from
 * objectui#8071 slice 9 (`objectMetricDrillDownMembers-8071.test.tsx`) states
 * the same limit in prose for the same reason, and keeps covering `enabled`,
 * `target`'s two in-place arms, `title`'s precedence chain, `report`'s branch
 * selection and the metric-filter invariant, which is the net this reroute
 * landed on top of.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, DrillNavigationProvider } from '@object-ui/react';
// Registers `object-metric` AND the `object-data-table` the drawer body
// renders, at MODULE scope — object-ui/no-dynamic-import-in-test-hook.
import '../index';

afterEach(cleanup);

type Params = Record<string, unknown>;

/** `n` deals, each with three authorable fields the drill list could show. */
const deals = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Deal ${i + 1}`,
    stage: 'won',
    amount: 100 + i,
  }));

const drillAdapter = (rows = deals(3)) => ({
  aggregate: vi.fn(async (_object: string, _params: Params) => [{ amount_sum: 120 }]),
  find: vi.fn(async (_object: string, _params: Params) => ({ data: rows })),
  getObjectSchema: vi.fn(async () => ({
    fields: {
      name: { type: 'text', label: 'Name' },
      stage: { type: 'text', label: 'Stage' },
      amount: { type: 'number', label: 'Amount' },
    },
  })),
});

const BASE = {
  type: 'object-metric',
  objectName: 'deal',
  label: 'Revenue',
  aggregate: { field: 'amount', function: 'sum' },
  filter: { stage: 'won' },
} as const;

const mount = (
  schema: Record<string, unknown>,
  adapter: unknown,
  openRecordList?: (object: string, filter?: Record<string, unknown>) => void,
) =>
  render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <SchemaRendererProvider dataSource={adapter as never}>
        <SchemaRenderer schema={{ ...BASE, ...schema } as never} />
      </SchemaRendererProvider>
    </DrillNavigationProvider>,
  );

/** Click the metric tile. The tile is the only button before the drill opens. */
const clickTile = async () => {
  fireEvent.click(await screen.findByRole('button'));
};

/**
 * The open drill panel, located by the ARIA role both panel shapes expose
 * rather than by `DrillDownDrawer`'s own `data-testid`.
 *
 * That choice is what makes the ablation legible. The hand-rolled panel this
 * card removed rendered no `drill-down-body` testid, so a file anchored on the
 * testid reddens every row the moment the fix is reverted — including the
 * control rows, and for a reason that has nothing to do with the member each
 * row is about. Anchored on `role="dialog"`, which BOTH implementations
 * satisfy, each control stays green under the ablation and only the three
 * member rows turn red.
 */
const drillPanel = async () => screen.findByRole('dialog');

/** The drilled record list, once it has rendered its rows. */
const drillTable = async () => {
  const panel = await drillPanel();
  await waitFor(() => expect(within(panel).getAllByRole('row').length).toBeGreaterThan(1));
  return panel;
};

/**
 * Header cells of the drilled list — the observable `columns` moves.
 *
 * Lower-cased on purpose: the two column branches label differently (the
 * whitelist branch carries the raw field name through `fieldLabel`, the
 * auto-derive branch humanizes it), and that difference belongs to
 * `ObjectDataTable`, not to the member under test here. Comparing case-folded
 * keeps this file reading WHICH columns exist rather than how they are cased.
 */
const headerTexts = (body: HTMLElement) =>
  within(body).getAllByRole('columnheader').map((th) => (th.textContent ?? '').trim().toLowerCase());

/** Body rows of the drilled list — the observable `maxRows` moves. */
const bodyRowCount = (body: HTMLElement) =>
  within(body).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length > 0).length;

describe("object-metric — `drillDown.target: 'navigate'` reaches the host", () => {
  it('navigates to the list page and draws NO panel when the host wired drill navigation', async () => {
    const openRecordList = vi.fn();
    mount({ drillDown: { enabled: true, target: 'navigate' } }, drillAdapter(), openRecordList);
    await clickTile();

    // The metric's own resolved filter travels with it, so the list page opens
    // on the same slice the number was computed from.
    await waitFor(() => expect(openRecordList).toHaveBeenCalledWith('deal', { stage: 'won' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("draws the in-place panel and does NOT navigate on target: 'drawer' — the control that makes the row above a reading of `target`", async () => {
    // Same host handler, one member value apart. Before the reroute BOTH of
    // these drew the sheet and neither called the handler, so this pair is what
    // separates "the arm is read" from "a handler was present".
    const openRecordList = vi.fn();
    mount({ drillDown: { enabled: true, target: 'drawer' } }, drillAdapter(), openRecordList);
    await clickTile();

    expect(await drillPanel()).toBeTruthy();
    expect(openRecordList).not.toHaveBeenCalled();
  });

  it("falls back to the drawer on target: 'navigate' when the host provides NO handler — the contract's conditional half", async () => {
    // `DrillDownConfig.target` promises this fallback happens only when no host
    // navigation is available. The bug was that it happened either way.
    mount({ drillDown: { enabled: true, target: 'navigate' } }, drillAdapter(), undefined);
    await clickTile();

    expect(await drillPanel()).toBeTruthy();
  });
});

describe('object-metric — `drillDown.columns` whitelists the drilled list', () => {
  it('renders ONLY the named column', async () => {
    mount({ drillDown: { enabled: true, columns: ['name'] } }, drillAdapter());
    await clickTile();
    const headers = headerTexts(await drillTable());

    expect(headers).toEqual(['name']);
    expect(headers).not.toContain('stage');
    expect(headers).not.toContain('amount');
  });

  it('auto-derives every field when the member is absent — the control', async () => {
    mount({ drillDown: { enabled: true } }, drillAdapter());
    await clickTile();
    const headers = headerTexts(await drillTable());

    expect(headers).toContain('name');
    expect(headers).toContain('stage');
    expect(headers).toContain('amount');
  });
});

describe('object-metric — `drillDown.maxRows` caps the drilled list', () => {
  it('renders exactly `maxRows` rows out of the records the adapter returned', async () => {
    mount({ drillDown: { enabled: true, maxRows: 2 } }, drillAdapter(deals(12)));
    await clickTile();

    const panel = await drillTable();
    await waitFor(() => expect(bodyRowCount(panel)).toBe(2));
  });

  it('keeps the 25 the hand-rolled panel hard-coded when the member is absent', async () => {
    // Twelve rows is the control that makes this a reading of the block's own
    // fallback rather than of the shared drawer's: `data-table`'s default page
    // size is 10, so an unforwarded `maxRows` would show ten of these twelve.
    mount({ drillDown: { enabled: true } }, drillAdapter(deals(12)));
    await clickTile();

    const panel = await drillTable();
    await waitFor(() => expect(bodyRowCount(panel)).toBe(12));
  });
});
