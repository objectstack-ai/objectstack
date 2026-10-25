/**
 * The grid's search box reaches the server (objectui#3118).
 *
 * Before the fix, DataTable's search box filtered whatever rows the table was
 * holding. Under server pagination that is ONE PAGE, so "2 results" was true of
 * fifty rows and said nothing about the 3075 that never participated — with the
 * pager beside it reading `1 / 63`.
 *
 * After the fix a typed term becomes a `$search` on the refetch — the server
 * resolves which fields it matches from the object's metadata (ADR-0061), the
 * same channel the ListView toolbar has always used — and the grid returns to
 * page 1, because a new term makes "page 5" a different set of rows (usually
 * no rows at all).
 *
 * This is #3106's collapse of a window-scoped operation, one axis over: sort
 * there, filter here. The tests below are its structural twins, plus one the
 * sort axis did not need — that the client-side pass is OFF rather than
 * stacked underneath the server's answer.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
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
/** How many records the fake server says match any search term. */
const MATCHES = 2;

/**
 * A server that actually honours `$search`: it answers with a different, much
 * smaller collection, and — the load-bearing detail — one whose rows do NOT
 * contain the typed term as rendered text. A client-side pass left running on
 * top would therefore reduce the server's answer to nothing, which is how these
 * tests can tell "the server searched" from "the browser searched".
 */
function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const searching = typeof params.$search === 'string' && params.$search !== '';
    const total = searching ? MATCHES : TOTAL;
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const count = Math.max(0, Math.min(top, total - skip));
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `id-${skip + i}`,
      name: searching ? `Match ${skip + i}` : `Row ${skip + i}`,
      status: 'open',
    }));
    return { data: rows, total, hasMore: skip + rows.length < total, pageSize: top };
  });
  return {
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'text' },
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

const searchBox = (container: HTMLElement) =>
  // U+2026, matching `table.search` in the en pack (objectui#3878).
  container.querySelector('input[placeholder="Search…"]') as HTMLInputElement;

/**
 * The rendered rows, as their full text. Whole-row text rather than the first
 * cell: the grid prepends chrome columns (row number, selection) whose content
 * is not the record's.
 */
const rowTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');

describe('ObjectGrid — the search box is server-side under server pagination (#3118)', () => {
  it('turns a typed term into a $search on the refetch', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: 'acme' } });

    await waitFor(() => {
      expect(lastFindParams(ds).$search).toBe('acme');
    });
  });

  it('does NOT filter the page it is holding — the server\'s answer is what renders', async () => {
    // The revert-proof assertion. Remove the wiring and this test reports the
    // defect verbatim: `Match 0` never arrives (no request carried the term)
    // and the grid renders the current page filtered down to the rows whose
    // text happens to contain "acme" — none — i.e. "no results" out of 300.
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: 'acme' } });

    await waitFor(() => expect(screen.getByText('Match 0')).toBeInTheDocument());
    // Every row the server returned is on screen, including the ones that do
    // not contain the term as text: matching is the server's business (which
    // fields, and how) and a second local pass would silently overrule it.
    const rows = rowTexts(container);
    expect(rows).toHaveLength(MATCHES);
    expect(rows[0]).toContain('Match 0');
    expect(rows[1]).toContain('Match 1');
  });

  it('reports the real match total, not the count within one page', async () => {
    // The half of the defect the user actually reads: "N results" has to be a
    // statement about the collection. It comes from the same response.
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: 'acme' } });

    await waitFor(() => expect(screen.getByText('Match 0')).toBeInTheDocument());
    await waitFor(() =>
      expect(container.textContent).toContain(`${MATCHES}`),
    );
    // 300 records over 50 per page was `1 / 6`; the searched collection is one
    // page, so the old page count must be gone rather than left standing next
    // to two rows.
    expect(container.textContent).not.toContain('/ 6');
  });

  it('returns to page 1 — a new term makes the old page index a different set of rows', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    // Advance off page 1 first (last-page button guarantees a forward jump).
    const navButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(navButtons[navButtons.length - 1]);
    await waitFor(() => expect(lastFindParams(ds).$skip).toBeGreaterThan(0));

    fireEvent.change(searchBox(container), { target: { value: 'acme' } });

    await waitFor(() => {
      const p = lastFindParams(ds);
      expect(p.$search).toBe('acme');
      expect(p.$skip ?? 0).toBe(0);
    });
  });

  it('sends $searchFields only when the view declared searchableFields (ADR-0061)', async () => {
    // The term is the client's; WHICH fields it matches is the server's, read
    // from the object's metadata. A view may narrow that set — never widen it —
    // so the parameter is absent unless the view asked for the narrowing.
    const plain = makeDataSource();
    const { container: c1 } = renderGrid(plain);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    fireEvent.change(searchBox(c1), { target: { value: 'acme' } });
    await waitFor(() => expect(lastFindParams(plain).$search).toBe('acme'));
    expect(lastFindParams(plain).$searchFields).toBeUndefined();

    const narrowed = makeDataSource();
    const { container: c2 } = renderGrid(narrowed, { searchableFields: ['name'] });
    await waitFor(() => expect(narrowed.find).toHaveBeenCalled());
    fireEvent.change(searchBox(c2), { target: { value: 'acme' } });
    await waitFor(() => {
      expect(lastFindParams(narrowed).$searchFields).toEqual(['name']);
    });
  });

  it('clearing the box returns to the unsearched collection', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: 'acme' } });
    await waitFor(() => expect(screen.getByText('Match 0')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: '' } });

    await waitFor(() => {
      // Absent, not `$search: ''` — an empty term is not a query the server
      // should have to interpret.
      expect(lastFindParams(ds).$search).toBeUndefined();
    });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
  });

  it('renders no search box when the view turned search off', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, { showSearch: false });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    expect(searchBox(container)).toBeNull();
    // This is the ListView path: it passes `showSearch: false` and searches
    // from its own toolbar, which is why #3118 never reached it.
  });
});

/**
 * The MEMBERS of `object-grid`'s `searchableFields`, pinned at what the
 * RENDERER reads (objectui#8071).
 *
 * The rows above already carry ONE of them — a single-member `['name']`
 * reaching `$searchFields`, with the absent control beside it. That is the
 * forwarding half, and it is why this key is pinned in this file rather than in
 * a new one. What it could not say, because a one-member array cannot say it:
 *
 *   - members arrive VERBATIM and IN ORDER, so the narrowing the view asked for
 *     is the narrowing the server is handed;
 *   - **an EMPTY array is not "narrow nothing", it is search OFF.** The read is
 *     `schema.searchableFields !== undefined ? length > 0 : showSearch ?? true`,
 *     so `searchableFields: []` removes the search box from the toolbar
 *     altogether. An author who empties the list while re-picking fields loses
 *     the control, not the narrowing — nothing is thrown and no diagnostic says
 *     the key did it;
 *   - **the canonical key overrules the deprecated boolean.** `showSearch:
 *     false` beside a non-empty `searchableFields` is IGNORED, which is the
 *     direction half-migrated metadata is least likely to expect.
 */
describe('ObjectGrid — `searchableFields` members decide the search surface (objectui#8071)', () => {
  it('forwards its members VERBATIM and IN ORDER, not as a sorted set', async () => {
    const ds = makeDataSource();
    // Deliberately NOT alphabetical: a fold that normalised or sorted the list
    // would pass a single-member fixture and fail here.
    const { container } = renderGrid(ds, { searchableFields: ['status', 'name'] });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: 'acme' } });

    await waitFor(() => {
      expect(lastFindParams(ds).$searchFields).toEqual(['status', 'name']);
    });
  });

  it('an EMPTY `searchableFields` turns the search box OFF', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, { searchableFields: [] });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    expect(
      searchBox(container),
      'an empty member list disables search rather than narrowing nothing',
    ).toBeNull();
  });

  it('a non-empty `searchableFields` overrules a deprecated `showSearch: false`', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds, {
      searchableFields: ['name'],
      showSearch: false,
    });
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    // The row in the block above renders NO box for `showSearch: false` alone,
    // which is this row's control: the only difference here is the member list.
    expect(searchBox(container)).not.toBeNull();

    fireEvent.change(searchBox(container), { target: { value: 'acme' } });
    await waitFor(() => expect(lastFindParams(ds).$searchFields).toEqual(['name']));
  });
});

describe('ObjectGrid — a client-paginated grid still searches client-side', () => {
  const inlineRows = [
    { id: 'a', name: 'Alpha', status: 'open' },
    { id: 'b', name: 'Bravo', status: 'done' },
    { id: 'c', name: 'Charlie', status: 'hold' },
  ];

  const renderInline = (opts?: Record<string, any>) =>
    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'task',
            columns: [
              { field: 'name', label: 'Name' },
              { field: 'status', label: 'Status' },
            ],
            data: { provider: 'value', items: inlineRows },
            ...opts,
          } as any}
        />
      </ActionProvider>,
    );

  it('filters in memory — there is no window, so the count is honest', async () => {
    // Inline data IS the collection. Filtering it says something true about the
    // list, so #3118 leaves this path exactly as it was.
    const { container } = renderInline();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: 'Brav' } });

    await waitFor(() => {
      const rows = rowTexts(container);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('Bravo');
    });
  });

  it('keeps the term it was typed — the box is uncontrolled here', async () => {
    const { container } = renderInline();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.change(searchBox(container), { target: { value: 'hold' } });

    await waitFor(() => expect(searchBox(container).value).toBe('hold'));
    const rows = rowTexts(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Charlie');
  });
});
