/**
 * Column-header sorting reaches the server (objectui#3106).
 *
 * Before the fix, DataTable's header sort was internal state with no callback
 * out of the component, so under server pagination it reordered the fifty rows
 * on screen and stopped there. The list looked sorted by that column; page 2
 * started over. Nothing said so.
 *
 * After the fix a header click becomes a `$orderby` on the refetch — the sort
 * applies to the whole collection — and the grid returns to page 1, because a
 * new ordering makes "page 5" a different set of rows.
 *
 * The relational-column half is #3096's: a `lookup` column shows a related
 * record's name while the server can only order by the stored id
 * (objectstack#4256 settled that no join is coming), so those headers are
 * withheld rather than offered as an ordering by something invisible.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid, parseSchemaSort } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { resetRetiredSortSpellingReports } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const TOTAL = 300;
const PAGE_SIZE = 50;

function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from({ length: Math.max(0, Math.min(top, TOTAL - skip)) }, (_, i) => ({
      id: `id-${skip + i}`,
      name: `Row ${skip + i}`,
      status: 'open',
      owner: { id: 'u1', name: 'Ada' },
    }));
    return { data: rows, total: TOTAL, hasMore: skip + rows.length < TOTAL, pageSize: top };
  });
  return {
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'text' },
        owner: { type: 'lookup', reference: 'user' },
      },
    }),
  } as any;
}

function renderGrid(dataSource: any, opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'task',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'status', label: 'Status' },
      { field: 'owner', label: 'Owner' },
    ],
    pagination: { pageSize: PAGE_SIZE },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
}

const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

const headerCell = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find((th) =>
    th.textContent?.includes(label),
  ) as HTMLElement;

describe('ObjectGrid — column-header sorting is server-side (#3106)', () => {
  it('turns a header click into an $orderby on the refetch', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    fireEvent.click(headerCell(container, 'Status'));

    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'asc' }]);
    });
  });

  it('toggles to descending on the second click', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    fireEvent.click(headerCell(container, 'Status'));
    await waitFor(() => expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'asc' }]));

    fireEvent.click(headerCell(container, 'Status'));
    await waitFor(() => expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'desc' }]));
  });

  it('returns to page 1 — a new ordering makes the old page index a different set of rows', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    // Advance off page 1 first (last-page button guarantees a forward jump).
    const navButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(navButtons[navButtons.length - 1]);
    await waitFor(() => expect(lastFindParams(ds).$skip).toBeGreaterThan(0));

    fireEvent.click(headerCell(container, 'Status'));

    await waitFor(() => {
      const p = lastFindParams(ds);
      expect(p.$orderby).toEqual([{ field: 'status', order: 'asc' }]);
      expect(p.$skip ?? 0).toBe(0);
    });
  });

  it('replaces the view\'s declared sort rather than stacking on it', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, { sort: [{ field: 'name', order: 'desc' }] });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    // Authored in the ONE declared spelling. This case used to author the
    // retired string clause and assert that it went out verbatim; objectui#8767
    // made this block REFUSE a string (objectui#8221), so a string here would
    // reach no `$orderby` at all and the click would have nothing to replace.
    // The array arm still lowers to this block's own `"field order"` string —
    // unchanged, which is the point of route C.
    expect(lastFindParams(ds).$orderby).toBe('name desc');

    fireEvent.click(headerCell(container, 'Status'));

    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'asc' }]);
    });
  });

  it('shows the view\'s declared sort before anyone clicks', async () => {
    // Otherwise the first click on that column asks for `asc` on a list that is
    // already `desc`, and the arrow only tells the truth from click two on.
    //
    // Authored in the ONE declared spelling. This case used to author the
    // retired string clause; the subject is the header behaviour and the
    // spelling was incidental, so it moves to the array for the same reason
    // the sibling case above did. What a string does to this same schema is
    // pinned deliberately, in the case below.
    const ds = makeDataSource();
    const { container } = renderGrid(ds, { sort: [{ field: 'status', order: 'desc' }] });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    expect(headerCell(container, 'Status').querySelector('[class*="chevron-down"]')).not.toBeNull();

    // …and clicking it therefore toggles to ascending rather than restating desc.
    fireEvent.click(headerCell(container, 'Status'));
    await waitFor(() => {
      expect(lastFindParams(ds).$orderby).toEqual([{ field: 'status', order: 'asc' }]);
    });
  });

  it('a retired STRING sort lights NO arrow — the header reads the key exactly as the fetch path does (objectui#8961)', async () => {
    // Both readers of one key, in agreement. objectui#8767 made the fetch path
    // REFUSE a string `sort`; the header indicators are fed by
    // `parseSchemaSort`, a second private reader that went on parsing one, so
    // this very schema drew a confident `status desc` arrow over rows the
    // server had returned in NO declared order — and the first click on that
    // column then asked for `asc` on a list that was in no order at all.
    //
    // This case used to pin that divergence rather than tolerate it: it
    // asserted the arrow WAS drawn beside the empty query, so the state read
    // as a recorded defect instead of an expected one. The ruling on
    // objectui#8961 (director batch #135 item 5, letter A) closed it by
    // narrowing the reader to the declared array, so the ARROW half flips
    // here. The wire half is unchanged and stays asserted: "no arrow" is the
    // right answer only while the query really does carry no ordering.
    resetRetiredSortSpellingReports();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ds = makeDataSource();
      const { container } = renderGrid(ds, { sort: 'status desc' });
      await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

      // Half one — the header states nothing about an ordering this list does
      // not have. NEITHER direction, not merely "not descending".
      const status = headerCell(container, 'Status');
      expect(status.querySelector('[class*="chevron-down"]')).toBeNull();
      expect(status.querySelector('[class*="chevron-up"]')).toBeNull();
      // CONTROL, non-vacuity — the column is still sortable and still renders
      // its header chrome, so the two nulls above mean "no ACTIVE sort" rather
      // than "no icons here at all", which is how they would also pass if the
      // harness or the column had silently stopped offering sorting.
      expect(status.querySelector('[class*="chevrons-up-down"]')).not.toBeNull();

      // Half two — and the query it was fetched with carries no ordering at
      // all. `hasOwnProperty`, not `toBeUndefined`: the key is absent, which is
      // a different claim from "present and undefined".
      const params = lastFindParams(ds);
      expect(Object.prototype.hasOwnProperty.call(params, '$orderby')).toBe(false);

      // …and the author is told once, by PR #8758's own reporter on the fetch
      // path. STILL once: narrowing the header reader deliberately did not add
      // a second diagnostic for the same spelling — one refusal, one voice.
      const retired = errorSpy.mock.calls.filter((c) =>
        String(c[0]).includes('objectui#8221'),
      );
      expect(retired).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a retired `defaultSort` lights NO arrow and sends NO $orderby — both readers dropped it (objectui#5861)', async () => {
    // Until objectui#5861 the header reader fell back to `defaultSort` after
    // `sort` and the fetch path had a third arm for it, so this schema drew a
    // `status desc` arrow over a `status desc` query. The key is an ADR-0049
    // tombstone — `@objectstack/spec` refuses it by name on `object-grid` —
    // and both readers dropped it in the same change, so they still agree:
    // no arrow, and no ordering on the wire. The canonical control is `shows
    // the view's declared sort before anyone clicks` above, same harness.
    const ds = makeDataSource();
    const { container } = renderGrid(ds, { defaultSort: { field: 'status', order: 'desc' } });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    const status = headerCell(container, 'Status');
    expect(status.querySelector('[class*="chevron-down"]')).toBeNull();
    expect(status.querySelector('[class*="chevron-up"]')).toBeNull();
    // Non-vacuity: the column still renders its sortable header chrome, so the
    // two nulls mean "no ACTIVE sort", not "no icons here at all".
    expect(status.querySelector('[class*="chevrons-up-down"]')).not.toBeNull();

    expect(Object.prototype.hasOwnProperty.call(lastFindParams(ds), '$orderby')).toBe(false);
  });

  it('withholds the sort affordance from a relational column (#3096)', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    const owner = headerCell(container, 'Owner');
    expect(owner.className).not.toContain('cursor-pointer');

    const before = ds.find.mock.calls.length;
    fireEvent.click(owner);
    // No refetch: the click is not a sort request.
    await new Promise((r) => setTimeout(r, 20));
    expect(ds.find.mock.calls.length).toBe(before);
  });
});

/**
 * ⚠️ This block pins the header reader's OWN contract. Since objectui#8961
 * that contract is exactly as wide as the fetch path's: the declared
 * `[{ field, order }]` array and nothing else (objectui#8221 retired the string
 * clauses, objectui#8767 made the fetch path refuse them). The cases below used
 * to admit the retired spellings because this reader still did, and re-judging
 * them was named as this card's work; that is what has happened.
 *
 * These refusals are the unit-level half of the rendered pin above — the `[]`
 * here is what the "no arrow" there is made of.
 *
 * Non-vacuity: every refusal is paired with a CONTROL in the same shape — the
 * declared array must still parse, single- and multi-key. A reader that had
 * simply stopped returning anything would fail those controls, so `[]` is a
 * verdict here and not silence.
 */
describe('parseSchemaSort — the header reader reads the ONE declared spelling (objectui#8961)', () => {
  it('REFUSES the bare-string form — no arrow, matching the `$orderby` the fetch path does not send', () => {
    expect(parseSchemaSort('name desc')).toEqual([]);
    // The one-word spelling too, not just the two-word one.
    expect(parseSchemaSort('name')).toEqual([]);
  });

  it('REFUSES string entries INSIDE an array, entry by entry', () => {
    expect(parseSchemaSort(['status asc', 'name desc'])).toEqual([]);
    // Per entry, not a whole-value veto: one retired entry cannot blank the
    // keys the author did spell in the declared form.
    expect(parseSchemaSort(['status asc', { field: 'name', order: 'desc' }])).toEqual([
      { field: 'name', order: 'desc' },
    ]);
  });

  it('CONTROL — reads the declared `SortConfig[]` form, single- and multi-key', () => {
    expect(parseSchemaSort([{ field: 'name', order: 'desc' }])).toEqual([
      { field: 'name', order: 'desc' },
    ]);
    expect(
      parseSchemaSort([
        { field: 'status', order: 'asc' },
        { field: 'name', order: 'desc' },
      ]),
    ).toEqual([
      { field: 'status', order: 'asc' },
      { field: 'name', order: 'desc' },
    ]);
  });

  it('CONTROL — a declared entry with no `order` still reads ascending', () => {
    // Untouched by objectui#8961, and named here so the narrowing is not read
    // as a second, stricter judgement of the ENTRY: what moved is which
    // SPELLING of the key is admitted, not how a declared entry is read.
    expect(parseSchemaSort([{ field: 'name' }])).toEqual([{ field: 'name', order: 'asc' }]);
  });

  it('yields nothing for an absent or unreadable sort', () => {
    expect(parseSchemaSort(undefined)).toEqual([]);
    expect(parseSchemaSort(null)).toEqual([]);
    expect(parseSchemaSort(42)).toEqual([]);
  });
});
