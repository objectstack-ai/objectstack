/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#4250 — the DOM half of the `richtext` spelling fix. `SKIP_TYPES` is
 * matched against the raw `def.type`, and its member was `rich_text`: a
 * spelling `@objectstack/spec` rejects outright (it exists only as a typo key in
 * the spec's own suggestion table), so the set excluded nothing while a real
 * spec-spelled `richtext` field was auto-derived into a related-list column.
 *
 * These pins assert the RENDERED column set, not the set's string membership —
 * revert `richtext`/`markdown` out of `SKIP_TYPES` and the two "not derived"
 * cases go red on a header that reappears.
 *
 * WHAT THE CELL ACTUALLY DID (measured on the pre-fix tree, and why the pin is
 * phrased as "no document markup" rather than "no raw markup"): a `richtext`
 * value did NOT render as raw markup. `getCellRenderer('richtext')` resolves to
 * `MarkdownCellRenderer`, so the cell held FORMATTED, sanitized GFM. The harm is
 * that the formatted output is BLOCK-level — `<h1>` / `<p>` / `<ul>` — inside a
 * `truncate` single-line table cell, so a document rendered as one clipped
 * heading with the rest invisible. `html` (already skipped) formats the same
 * way through `HtmlCellRenderer`, which is why "has a formatting renderer" was
 * never the discriminator this set used.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Desktop, pinned rather than inherited (objectui#8399). `RelatedList` reads
 * `useIsMobile` (breakpoint 768): above it a `type="table"` list renders a real
 * `data-table`, below it an `object-gallery` card layout with no headers, no
 * cells and no sort.
 *
 * Every case here reads the derived column set through its rendered headers.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

/** Multi-block markdown — the shape whose formatted render is `<h1>` + `<ul>`. */
const DOC = '# Heading\n\n**bold** and `code`\n\n- one\n- two';

/**
 * HOW EVERY CASE IN THIS FILE STAYS NON-VACUOUS (#4325).
 *
 * The markdown cell renderer sits behind `React.lazy` in `@object-ui/fields`,
 * so a richtext column is on screen for a while before it renders anything a
 * text query recognises. This file used to win that race by side-effect-
 * importing the lazy chunk at module scope
 * (`@object-ui/fields/widgets/MarkdownContent`) — a specifier the package's
 * `exports` map does not publish and only the repo's vitest source alias
 * resolved. #4325 ruled that subpath out: `@object-ui/fields`' surface is its
 * index, and one test's preload does not justify minting permanent public API.
 *
 * Preloading through the SANCTIONED entry does not replace it — measured, not
 * assumed. Importing `@object-ui/fields` at module scope leaves the chunk cold:
 * the index only DECLARES `React.lazy(() => import('./widgets/MarkdownContent'))`
 * (src/index.tsx), and evaluating the declaring module never runs the factory.
 * A probe rendering `MarkdownCellRenderer` straight after that import saw the
 * Suspense fallback synchronously (`h1` absent) and waited 321.8ms for the
 * chunk on an IDLE container. AGENTS.md §测试纪律 records first-`import()`
 * latencies up to 976ms under full parallel load against RTL's 1000ms default,
 * so any `findBy`/`waitFor` on post-boundary content is a coin flip decided by
 * machine load, not by the code under test.
 *
 * So the race is REMOVED rather than won: every case asserts on a witness that
 * is present in EVERY state of the lazy boundary, via `documentCells()` —
 *
 *   - unresolved — `MarkdownCellRenderer`'s Suspense fallback renders the raw
 *     value, `<span># Heading\n\n**bold** …</span>`;
 *   - resolved — `<h1>Heading</h1>` + `<ul>`;
 *   - either way — for a normal (non-`fitContent`) column the data-table cell
 *     wrapper carries the raw value in `title=`
 *     (`components/renderers/complex/data-table.tsx`), and that wrapper is
 *     rendered OUTSIDE the Suspense boundary, so the witness survives even if
 *     the fallback is ever changed to render nothing.
 *
 * The same predicate reports both directions, which is what makes the absence
 * assertions provably non-vacuous: measured on this tree with the chunk cold, a
 * richtext column that IS present reads as `queryByText('Heading') === null`
 * and `querySelector('td h1') === null` — the assertions this file used to
 * make, green for the wrong reason — while `documentCells()` already sees it.
 */
function documentCells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('td')).filter(
    (td) =>
      td.textContent?.includes('Heading') ||
      Array.from(td.querySelectorAll('[title]')).some((el) =>
        el.getAttribute('title')?.includes('Heading'),
      ),
  );
}

const fields = {
  subject: { type: 'text', label: 'Subject' },
  amount: { type: 'currency', label: 'Amount' },
  body_rt: { type: 'richtext', label: 'Body Rich' },
  body_md: { type: 'markdown', label: 'Body Markdown' },
  body_html: { type: 'html', label: 'Body Html' },
  payload: { type: 'json', label: 'Payload' },
  memo: { type: 'textarea', label: 'Memo' },
};

const row = {
  id: 'n1',
  subject: 'Note one',
  amount: 42,
  body_rt: DOC,
  body_md: DOC,
  body_html: '<b>htmlbold</b>',
  payload: { a: 1 },
  memo: 'a plain long-form memo',
};

const makeDS = (rows: any[]) => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async () => ({ name: 'note_line', fields })),
});

function renderList(extra: Record<string, unknown> = {}) {
  return render(
    <RelatedList
      title="Notes"
      type="table"
      api="note_line"
      objectName="note_line"
      referenceField="note"
      parentId="N-1"
      maxColumns={10}
      dataSource={makeDS([row]) as any}
      {...(extra as any)}
    />,
  );
}

describe('RelatedList — long-form types stay out of auto-derived columns (#4250)', () => {
  it('does not derive a column for a spec-spelled `richtext` field', async () => {
    const { container } = renderList();
    // Readiness signal: the row's own `subject` cell. `text` has no lazy
    // boundary, so this is bounded by the data fetch alone — and once it is on
    // screen the table BODY is committed, which is what makes the absence
    // assertions below meaningful (a derived column's cell would be in that
    // same commit). Awaiting a header would not carry that guarantee.
    await waitFor(() => expect(screen.getByText('Note one')).toBeTruthy());
    // Control: the walk ran and produced real columns.
    expect(screen.getByText('Subject')).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();

    expect(screen.queryByText('Body Rich')).toBeNull();
    // …and nothing rendered the document into a cell, in any lazy state.
    expect(documentCells(container)).toHaveLength(0);
  });

  it('does not derive a column for a `markdown` field either', async () => {
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText('Note one')).toBeTruthy());
    expect(screen.queryByText('Body Markdown')).toBeNull();
    expect(documentCells(container)).toHaveLength(0);
  });

  it('keeps the pre-existing `html` / `json` exclusions', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('Subject')).toBeTruthy());
    expect(screen.queryByText('Body Html')).toBeNull();
    expect(screen.queryByText('Payload')).toBeNull();
  });

  it('still derives `textarea` — plain truncated text is a useful cell', async () => {
    renderList();
    // The measurement read the other way: `textarea` has no block-level render,
    // so excluding it would hide a business column for nothing (objectui#2360).
    await waitFor(() => expect(screen.getByText('Memo')).toBeTruthy());
    expect(screen.getByText('a plain long-form memo')).toBeTruthy();
  });

  it('an AUTHOR-DECLARED richtext column is still rendered', async () => {
    // The set filters the zero-config auto-derive walk only. An explicit column
    // is the author saying they want it — over-skipping that is the objectui#2360
    // harm, and this is the control that says the fix did not reintroduce it.
    const { container } = renderList({ columns: ['subject', 'body_rt'] });
    await waitFor(() => expect(screen.getByText('Body Rich')).toBeTruthy());
    // Same witness as the absence cases, read the other way. It used to be
    // `findByText('Heading')`, which only ever passed because the deleted
    // module-scope preload had already resolved the chunk; without that preload
    // it would be a 1000ms budget racing a load measured at up to 976ms. The
    // pair also closes the loop on the absence assertions above — one predicate
    // that reports 1 here and 0 there cannot be silently vacuous in either.
    expect(documentCells(container)).toHaveLength(1);
  });
});
