/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A detail collection in `object-master-detail-form` must keep its own identity
 * — and therefore its own rows — when the authored `details` array is reordered
 * or shortened (objectui#6371).
 *
 * ## The claim this file does NOT make
 *
 * ⛔ There is **no duplicate-key collision**. `MasterDetailForm.tsx` used to key
 * each section on `` `${d.childObject}-${i}` `` where `i` is the map index, so
 * two declined details keyed as `undefined-0` and `undefined-1` — distinct. No
 * React duplicate-key warning was ever emitted and nothing remounted for that
 * reason. Anyone re-deriving this starts from the INDEX-IDENTITY hazard below,
 * never from a collision claim.
 *
 * ## The hazard that IS real
 *
 * For a declined detail the data half of that key (`childObject`) is
 * `undefined`, so the section's React identity was purely its POSITION in
 * `details`. The row-state array was indexed the same way, and `state` is
 * seeded once at mount from the ORIGINAL `rawDetails` — it is never re-synced
 * when the authored config changes in create mode. So reordering or removing an
 * entry re-associated, by position:
 *
 *   - the section's DOM node,
 *   - `state[i]` at the grid value (`MasterDetailForm.tsx` row value), and
 *   - `state[i]` inside the SUBTOTAL reducer — a reorder did not merely show
 *     the wrong grid, it MIS-COMPUTED the document total.
 *
 * ⭐ The subtotal is the assertion worth having: it is the consequence a reader
 * of the card would not predict, and it is measured here, not argued.
 *
 * ## Why `amountField` is deliberately NOT `amount`
 *
 * The reducer falls back to `'amount'` when an entry declares no `amountField`.
 * If the resolved collection summed the default key, a mis-associated reducer
 * would read the SAME number out of the wrong rows and the bug would hide. The
 * resolved collection therefore sums `line_total`, so a position-swapped read
 * yields 0 and the defect is visible.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const PARENT = 'po';
const parentSchema = {
  name: PARENT,
  fields: {
    ref: { type: 'text', label: 'Ref' },
    // Present so the Subtotal / Tax / Total stack renders: `taxRateField`
    // defaults to `tax_rate` and the stack appears once the header carries it.
    tax_rate: { type: 'number', label: 'Tax Rate' },
  },
};
const childSchema = {
  name: 'po_line',
  fields: { line_total: { type: 'number', label: 'Line Total' }, po: { type: 'lookup', label: 'PO' } },
};

/** The RESOLVED collection — fully configured, so nothing about it is pending. */
const RESOLVED = {
  childObject: 'po_line',
  relationshipField: 'po',
  amountField: 'line_total',
  title: 'PO lines',
  columns: [{ name: 'line_total', label: 'Line Total', type: 'number' }],
} as any;

/** The DECLINED collection — no `childObject`, so it renders objectui#6360's hint. */
const DECLINED = { title: 'Unconfigured collection' } as any;

function makeDataSource(overrides: any = {}) {
  return {
    getObjectSchema: vi.fn(async (obj: string) => (obj === PARENT ? parentSchema : childSchema)),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    ...overrides,
  } as any;
}

function formSchema(details: any[]) {
  return { objectName: PARENT, mode: 'create', fields: ['ref', 'tax_rate'], details } as any;
}

/** Type an amount into the (single) resolved collection's grid. */
async function enterLineTotal(value: string) {
  const cell = await waitFor(() => screen.getAllByLabelText('Line Total')[0] as HTMLInputElement);
  fireEvent.change(cell, { target: { value } });
  return cell;
}

/**
 * Block until the re-rendered config has actually reached the DOM.
 *
 * ⚠️ Without this the reorder assertions are GHOSTS. `resolvedDetails` still
 * holds the PREVIOUS array when `rerender` returns — the resolve effect is
 * async — so the sections are still in their old order for a tick, and any
 * assertion that runs then reads the pre-reorder DOM and passes for the wrong
 * reason. Measured: with a plain `waitFor` on the cell value, its first
 * synchronous attempt succeeded against unmodified `origin/main`, where the
 * settled DOM in fact shows an empty grid.
 *
 * The gate is DOM order itself — the declined section standing ahead of the
 * grid section — which can only become true once the new config has landed.
 */
async function waitForDeclinedSectionsBefore(view: { container: HTMLElement }, declinedCount: number) {
  await waitFor(() => {
    const sections = Array.from(view.container.querySelectorAll('section'));
    const hints = sections.filter((s) => s.querySelector('[data-testid="md-detail-no-child-object"]'));
    const gridIdx = sections.findIndex((s) => s.querySelector('[data-testid="line-items"]'));
    expect(hints).toHaveLength(declinedCount);
    expect(gridIdx).toBeGreaterThanOrEqual(0);
    // Every declined section sits ahead of the grid section.
    hints.forEach((h) => expect(sections.indexOf(h)).toBeLessThan(gridIdx));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('object-master-detail-form — a detail entry keeps its identity across reorder (objectui#6371)', () => {
  it('keeps rows, the DOM node and the SUBTOTAL with their own collection when a detail above is reordered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = makeDataSource();
    const view = render(<MasterDetailForm schema={formSchema([RESOLVED, DECLINED])} dataSource={ds} />);

    await waitFor(() => expect(view.container.querySelector('input[name="ref"]')).not.toBeNull());
    await enterLineTotal('100');

    // Baseline, before anything moves: the row landed and the reducer sees it.
    await waitFor(() => expect(view.getByTestId('md-subtotal').textContent).toContain('100.00'));

    // The DOM node whose identity is under test. Held by reference: a remount
    // produces a DIFFERENT node object, which is exactly what an index key
    // caused when a sibling moved above it.
    const gridBefore = view.getByTestId('line-items');
    const sectionBefore = gridBefore.closest('section');
    expect(sectionBefore).not.toBeNull();

    // ⭐ Move the DECLINED entry above the resolved one. Nothing about the
    // resolved collection itself changed — only its position.
    view.rerender(<MasterDetailForm schema={formSchema([DECLINED, RESOLVED])} dataSource={ds} />);

    // Settle first — see `waitForDeclinedSectionsBefore`. Everything below reads
    // the DOM only after the new order is really on screen.
    await waitForDeclinedSectionsBefore(view, 1);

    // 1) The rows stayed with their own collection (the grid value read).
    //    Measured on unmodified `origin/main`: the grid holds one empty ghost
    //    row — the entered 100 is gone, because the resolved collection now
    //    reads the declined entry's slot.
    const cellAfter = screen.getAllByLabelText('Line Total')[0] as HTMLInputElement;
    expect(cellAfter.value).toBe('100');

    // 2) The subtotal is still computed from the collection's OWN rows.
    //    On the index-keyed reducer this read 0: the declined entry summed the
    //    resolved collection's rows under the default `amount` key, and the
    //    resolved collection summed the declined entry's empty rows.
    expect(view.getByTestId('md-subtotal').textContent).toContain('100.00');

    // 3) DOM identity: React moved the section, it did not remount it.
    const sectionAfter = view.getByTestId('line-items').closest('section');
    expect(sectionAfter).toBe(sectionBefore);

    // 4) The declined entry still renders its own config hint, and it did NOT
    //    acquire a grid holding someone else's rows.
    expect(view.getByTestId('md-detail-no-child-object').textContent).toContain('childObject');
    expect(view.getAllByTestId('line-items')).toHaveLength(1);

    warn.mockRestore();
    view.unmount();
  });

  it('keeps rows and the SUBTOTAL with their own collection when a detail above is REMOVED', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = makeDataSource();
    // Two declined entries above the resolved one — distinct sections today
    // (`undefined-0` / `undefined-1`), which is the correction this card
    // carries: the index disambiguates, so there is nothing to collide.
    const view = render(
      <MasterDetailForm schema={formSchema([DECLINED, { title: 'Second unconfigured' }, RESOLVED])} dataSource={ds} />,
    );

    await waitFor(() => expect(view.container.querySelector('input[name="ref"]')).not.toBeNull());
    await enterLineTotal('250');
    await waitFor(() => expect(view.getByTestId('md-subtotal').textContent).toContain('250.00'));

    // Drop the FIRST declined entry — everything below shifts up by one.
    view.rerender(
      <MasterDetailForm schema={formSchema([{ title: 'Second unconfigured' }, RESOLVED])} dataSource={ds} />,
    );

    await waitForDeclinedSectionsBefore(view, 1);

    const cellAfter = screen.getAllByLabelText('Line Total')[0] as HTMLInputElement;
    expect(cellAfter.value).toBe('250');
    expect(view.getByTestId('md-subtotal').textContent).toContain('250.00');

    warn.mockRestore();
    view.unmount();
  });

  it('sends each collection its OWN rows to the batch when a declined entry sits above it', async () => {
    // ⭐ The third position-associated read, which neither card names: the
    // submit path built its child payloads from
    // `details.filter(d => d.relationshipField).map((d, i) => stateRef.current[i])`.
    // After the filter, `i` indexes the FILTERED array while `stateRef` is
    // indexed against the FULL one, so a declined entry above a real collection
    // shifted the read by one and the collection's rows were silently dropped
    // from the transaction. This is data loss on save, not a display defect.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
    const ds = makeDataSource({ batchTransaction });
    const view = render(<MasterDetailForm schema={formSchema([DECLINED, RESOLVED])} dataSource={ds} />);

    const refInput = await waitFor(() => {
      const el = view.container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form not ready');
      return el;
    });
    fireEvent.change(refInput, { target: { value: 'PO-1' } });
    await enterLineTotal('42');

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));

    const ops = batchTransaction.mock.calls[0][0] as any[];
    const childOps = ops.filter((o) => o.object === 'po_line');
    expect(childOps, 'the resolved collection\'s row must reach the batch').toHaveLength(1);
    expect(childOps[0].data.line_total).toBe(42);

    warn.mockRestore();
    view.unmount();
  });

  it('DEGENERATE CONTROL: a resolved detail with no declined sibling is untouched', async () => {
    // ⭐ Without this, a change that reset or globally preserved row state would
    // pass the tests above. The ordinary path must still behave exactly as it
    // did: rows land, the subtotal follows them, no hint appears.
    const ds = makeDataSource();
    const view = render(<MasterDetailForm schema={formSchema([RESOLVED])} dataSource={ds} />);

    await waitFor(() => expect(view.container.querySelector('input[name="ref"]')).not.toBeNull());
    await enterLineTotal('7');

    await waitFor(() => expect(view.getByTestId('md-subtotal').textContent).toContain('7.00'));
    expect(view.queryByTestId('md-detail-no-child-object')).toBeNull();
    expect(view.getAllByTestId('line-items')).toHaveLength(1);

    view.unmount();
  });

  it('DEGENERATE CONTROL: a rerender that does NOT move anything changes nothing', async () => {
    // ⭐ Proves the identity is derived from the config rather than regenerated
    // per render: re-rendering with an equivalent config must neither remount
    // the section nor disturb its rows.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = makeDataSource();
    const view = render(<MasterDetailForm schema={formSchema([RESOLVED, DECLINED])} dataSource={ds} />);

    await waitFor(() => expect(view.container.querySelector('input[name="ref"]')).not.toBeNull());
    await enterLineTotal('12');
    await waitFor(() => expect(view.getByTestId('md-subtotal').textContent).toContain('12.00'));
    const sectionBefore = view.getByTestId('line-items').closest('section');

    view.rerender(<MasterDetailForm schema={formSchema([RESOLVED, DECLINED])} dataSource={ds} />);

    // The resolve effect re-runs even for an equivalent config; give it the
    // same settle window the reorder cases get, so this control is measured on
    // the same footing rather than on a stale frame.
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));

    const cellAfter = screen.getAllByLabelText('Line Total')[0] as HTMLInputElement;
    expect(cellAfter.value).toBe('12');
    expect(view.getByTestId('line-items').closest('section')).toBe(sectionBefore);
    expect(view.getByTestId('md-subtotal').textContent).toContain('12.00');

    warn.mockRestore();
    view.unmount();
  });
});
