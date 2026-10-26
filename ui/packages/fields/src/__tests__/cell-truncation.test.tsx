/**
 * Regression for objectstack-ai/objectui#3466: single-line cell renderers
 * emitted a BARE INLINE `span.truncate`. An inline box has no width box, so
 * `overflow:hidden` / `text-overflow:ellipsis` never engage — the value
 * rendered at full content width and its tail was silently clipped by
 * whatever ancestor happened to clip (the record-detail card edge), with no
 * ellipsis and no way to read the full text (the detail row's `title` is the
 * inline-edit hint, not the value). Same mechanism as the JSON cell fix in
 * objectui#2578.
 *
 * Pin: every single-line value renderer emits a BLOCK-level, `max-w-full`
 * truncating span that carries the full text in `title` (so hovering the
 * value shows the full text, taking precedence over any ancestor `title`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import {
  TextCellRenderer,
  LookupCellRenderer,
  UserCellRenderer,
  FileCellRenderer,
  SelectCellRenderer,
} from '../index';
import { SchemaRendererProvider } from '@object-ui/react';

const LONG =
  'A remarkably long referenced-record title that a detail card column can never fit on a single line without an ellipsis';

/** The block-level truncation contract every single-line value span must meet. */
function expectTruncating(el: HTMLElement, fullText: string) {
  expect(el).toHaveClass('block', 'max-w-full', 'truncate');
  expect(el).toHaveAttribute('title', fullText);
}

describe('cell renderers truncate for real and expose the full text (issue #3466)', () => {
  it('TextCellRenderer: block-level truncating span with title fallback', () => {
    render(<TextCellRenderer value={LONG} field={{ type: 'text' } as any} />);
    expectTruncating(screen.getByText(LONG), LONG);
  });

  it('LookupCellRenderer: expanded record object', () => {
    const ds = { find: vi.fn(), findOne: vi.fn() } as any;
    render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer
          value={{ id: 'rec1', name: LONG }}
          field={{ type: 'lookup', reference: 'obj_a' } as any}
        />
      </SchemaRendererProvider>,
    );
    expectTruncating(screen.getByText(LONG), LONG);
  });

  // ⚠️ UPDATED by objectui#8695, and the update is the finding, not a
  // formality: this case used to assert `expectTruncating(...)` on a
  // `LookupCellRenderer` primitive, which means #3466 pinned the CONFIDENT
  // bare-text rendering of a reference nothing had resolved — the reading was
  // deliberate once. objectui#8695 ruled that reading out (it is byte-identical
  // to a `text` cell, so the screen states a fact it does not have), so the arm
  // now draws the unresolved-reference affordance. #3466's contract is what
  // survives and is what is asserted here: a single-line value must not expand
  // its column, and its full text must stay reachable. The shape that meets it
  // moved — `truncate` sits on the text span inside an `inline-flex` wrapper
  // (`overflow: hidden` gives a flex item an automatic minimum size of zero,
  // so it shrinks rather than pushing the row wider), and the full value is
  // exposed through the wrapper's stated `title` rather than a bare one.
  it('LookupCellRenderer: primitive value nothing resolved — objectui#8695 affordance, still truncating', () => {
    const ds = { find: vi.fn(), findOne: vi.fn() } as any;
    const { container } = render(
      <SchemaRendererProvider dataSource={ds}>
        <LookupCellRenderer value={LONG} field={{ type: 'lookup' } as any} />
      </SchemaRendererProvider>,
    );

    const mark = container.querySelector<HTMLElement>('[data-slot="unresolved-reference"]')!;
    expect(mark, 'the unresolved arm states itself').not.toBeNull();
    expect(mark).toHaveClass('inline-flex', 'min-w-0', 'max-w-full');
    // The full text stays reachable, inside the sentence that names it.
    expect(mark.getAttribute('title')).toContain(LONG);
    // …and the value itself still ellipsises instead of growing the column.
    expect(screen.getByText(LONG)).toHaveClass('truncate');
  });

  it('UserCellRenderer: display name beside the avatar', () => {
    render(<UserCellRenderer value={{ name: LONG }} field={{ type: 'user' } as any} />);
    expectTruncating(screen.getByText(LONG), LONG);
  });

  it('FileCellRenderer: single file name', () => {
    render(<FileCellRenderer value={{ name: LONG }} field={{ type: 'file' } as any} />);
    expectTruncating(screen.getByText(LONG), LONG);
  });

  it('SelectCellRenderer (dot): bounded container with title, shrinkable label', () => {
    render(
      <SelectCellRenderer
        value="opt1"
        field={{
          type: 'select',
          appearance: 'dot',
          options: [{ value: 'opt1', label: LONG }],
        } as any}
      />,
    );
    const label = screen.getByText(LONG);
    // The label shrinks inside the dot row; the row itself is width-bounded
    // and carries the full text on hover.
    expect(label).toHaveClass('min-w-0', 'truncate');
    const row = label.parentElement!;
    expect(row).toHaveClass('max-w-full');
    expect(row).toHaveAttribute('title', LONG);
  });
});
