/**
 * Tests for the PageHeaderRenderer record header's WIDTH ARBITRATION between
 * the title column and the trailing action row (objectui#7244).
 *
 * The bug: the action tail is `shrink-0` (correct — buttons must not be
 * squeezed into unreadable slivers), and in a `flex-nowrap` row the title
 * column was the only flexible item, so it absorbed the entire width deficit.
 * With three labelled `record_header` actions plus `⋯` and `⟳`, the h1 was
 * driven to ~30px and rendered as a single character + ellipsis, while the
 * breadcrumb above it still showed the full record name.
 *
 * ⚠️ These assertions are CLASS-SHAPE assertions, deliberately. jsdom has no
 * layout engine — every `getBoundingClientRect()` here is 0×0 — so a width
 * regression CANNOT be caught by measuring in this suite. What is pinned is
 * the structural precondition that made the collapse possible, so that
 * removing either half of the fix turns this file red. The actual widths were
 * measured in a real browser (Chromium, showcase `showcase_field_zoo` record,
 * console dev server) and are recorded in the PR body:
 *
 *   viewport 799px, header 687px, tail 641.5px, gap-4 16px
 *     before: h1 =  29.5px (scrollWidth 180px → rendered "S…")
 *     after:  h1 = 180.0px (not clipped; tail wrapped to its own line)
 *   control — Account record (edit + `⋯` + `⟳`, tail 135.6px) at the same
 *   799px: h1 = 217.4px on ONE line, before and after alike.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Registers `page:header` at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010). This keeps the
// file in the light `dom` project instead of adding it to `heavyDomTests`.
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

/** The Field Zoo shape from the report: three labelled record-header actions. */
const WIDE_ACTIONS = [
  { name: 'gallery', locations: ['record_header'], label: 'Action Param Gallery' },
  { name: 'lookup_first', locations: ['record_header'], label: 'Lookup == first of many' },
  { name: 'assign_me', locations: ['record_header'], label: 'Assign to me (owner_id)' },
];

function renderRecordHeader(actions: any[] = WIDE_ACTIONS) {
  const utils = render(
    <ActionProvider>
      <RecordContextProvider
        objectName="showcase_field_zoo"
        recordId="rec-1"
        data={{ id: 'rec-1', name: 'Specimen — Full' }}
        objectSchema={{ name: 'showcase_field_zoo', label: 'Field Zoo' }}
        // A host `refresh` puts the `⟳` chrome in the tail, which is part of
        // what made the measured tail 641.5px wide.
        refresh={vi.fn()}
      >
        <PageHeader schema={{ type: 'page:header', actions }} />
      </RecordContextProvider>
    </ActionProvider>
  );
  const header = utils.container.querySelector('header');
  if (!header) throw new Error('record header did not render');
  const h1 = header.querySelector('h1');
  if (!h1) throw new Error('record title h1 did not render');
  // The title column is the direct child of <header> that owns the h1.
  const titleColumn = Array.from(header.children).find((child) =>
    child.contains(h1)
  ) as HTMLElement;
  return { ...utils, header, h1, titleColumn };
}

describe('PageHeaderRenderer — record title width arbitration (#7244)', () => {
  it('lets the header wrap so the deficit has somewhere to go', () => {
    const { header } = renderRecordHeader();
    // Pre-fix this was `flex flex-col sm:flex-row …` with no wrap at all: the
    // row could not break, so the only way to fit the tail was to starve the
    // title. Scoped to `sm:` — below 640px the header is already a column.
    expect(header.className).toContain('sm:flex-wrap');
    expect(header.className).toContain('sm:flex-row');
  });

  it('gives the title column a width floor it will not yield at sm and up', () => {
    const { titleColumn } = renderRecordHeader();
    // The heart of the fix. Without a floor, `flex-1` + `min-w-0` means
    // "shrink me to zero before you shrink anything else".
    expect(titleColumn.className).toMatch(/\bsm:min-w-(?!0\b)\S+/);
    expect(titleColumn.className).toContain('flex-1');
  });

  it('keeps min-w-0 below sm so the h1 can still ellipsise', () => {
    const { titleColumn } = renderRecordHeader();
    // The floor must be ADDITIVE, not a replacement: `min-w-0` is what allows
    // `truncate` to clip at all. Dropping it would make a long title overflow
    // the header instead of ellipsising.
    expect(titleColumn.className).toContain('min-w-0');
  });

  it('still truncates rather than wrapping the title text itself', () => {
    const { h1 } = renderRecordHeader();
    expect(h1.className).toContain('truncate');
    expect(h1.textContent).toBe('Specimen — Full');
  });

  it('leaves the action tail unshrinkable', () => {
    const { header, titleColumn } = renderRecordHeader();
    const tail = header.lastElementChild as HTMLElement;
    expect(tail).not.toBe(titleColumn);
    // The tail keeping `shrink-0` is intentional and is why the title needed a
    // floor: squeezing the buttons instead would just move the illegibility.
    expect(tail.className).toContain('shrink-0');
  });

  it('applies the same arbitration to a light action tail', () => {
    // The Account-record control: one labelled action. The classes are
    // unconditional, so a header that already fits is unaffected at runtime —
    // 192px floor + 16px gap + a ~136px tail leaves the row uncrowded.
    const { header, titleColumn } = renderRecordHeader([
      { name: 'edit', locations: ['record_header'], label: 'Edit' },
    ]);
    expect(header.className).toContain('sm:flex-wrap');
    expect(titleColumn.className).toMatch(/\bsm:min-w-(?!0\b)\S+/);
  });
});
