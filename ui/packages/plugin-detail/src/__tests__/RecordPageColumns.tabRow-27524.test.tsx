/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Targets 8 and 9 — the record page's tab row, through
 * `RecordPageColumns`: 「概览」, then 动态, then the related panels in the
 * reader's arrangement with their counts, the hidden panels' tabs at the end
 * of the dropdown; and the enlarged state as the active tab — the header and
 * the row stay as they are, the full face is drawn below the row, 「概览」
 * returns. The block renderer is stubbed, so what is measured is the page's
 * own composition; the row's width rule is pinned in `RecordTabRow-27524`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { RelatedCountStore } from '@object-ui/components';
import { DiscussionContextProvider, RecordContextProvider } from '@object-ui/react';
import { RecordTimelineCountContext, RecordTimelinePanelContext } from '../recordTimelineStream';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => <StubNode schema={schema} />,
}));

/** A block that draws its type and, for the 动态 stream, reports a size the way the stream does. */
function StubNode({ schema }: { schema: any }) {
  const panel = React.useContext(RecordTimelinePanelContext);
  const reporter = React.useContext(RecordTimelineCountContext);
  const isStream = schema?.type === 'record:activity';
  React.useEffect(() => {
    if (!isStream) return;
    if (panel) panel.onCount(7);
    else reporter?.(7);
  }, [isStream, panel, reporter]);
  const p = schema?.properties ?? {};
  return <section data-node={schema?.type} data-object={p.objectName} data-limit={p.limit} />;
}

import { RecordPageColumns } from '../RecordPageColumns';
import { RECORD_PAGE_TIMELINE_PANEL, buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
import { editRelatedArrangement } from '../synth/relatedArrangement';

const RELATED = [
  { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
  { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
  { objectName: 'call', relationshipField: 'lead_id', title: 'Calls' },
];
const DEFAULT = ['task.lead_id', 'note.parent_id', 'call.lead_id'];
const columnsOf = (options: { hideDiscussion?: boolean } = {}) =>
  buildDefaultPageColumns(
    buildDefaultPageSchema({ name: 'lead', fields: {} }, { related: RELATED, hideDiscussion: options.hideDiscussion ?? false }),
  )!;

const tabIds = () => Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.getAttribute('data-record-tab'));
const tabCount = (id: string) =>
  document.querySelector(`[role="tab"][data-record-tab="${id}"] [data-record-tab-count]`)?.textContent ?? null;
const activeTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-record-tab');

beforeEach(() => RelatedCountStore._reset());
afterEach(() => cleanup());

describe('the record page tab row (objectstack#27524, Target 8)', () => {
  it('sits at the bottom of the header: 概览, 动态, then the panels in the reader\'s order', () => {
    const stored = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const { container } = render(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        relatedArrangement={stored}
        onRelatedArrangementChange={vi.fn()}
        onEnlargeRelated={vi.fn()}
      />,
    );
    expect(tabIds()).toEqual(['overview', RECORD_PAGE_TIMELINE_PANEL, 'call.lead_id', 'task.lead_id', 'note.parent_id']);
    expect(activeTab()).toBe('overview');
    expect(document.querySelector('[data-record-tab="overview"]')?.textContent).toBe('Overview');
    // After the header nodes, before the page's columns.
    const frame = container.querySelector('[data-page-type="record"] > div')!;
    const children = Array.from(frame.children);
    const row = container.querySelector('[data-record-tab-row]')!;
    expect(children.indexOf(row)).toBe(children.indexOf(container.querySelector('[data-record-columns]')!) - 1);
    expect(children.slice(0, children.indexOf(row)).some((el) => el.matches('[data-node="page:header"]'))).toBe(true);
  });

  it('the hidden panels\' tabs are not on the row; they wait at the end of the dropdown', () => {
    const stored = editRelatedArrangement(DEFAULT, undefined, { kind: 'hide', id: 'note.parent_id' }, Date.now());
    render(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        relatedArrangement={stored}
        onRelatedArrangementChange={vi.fn()}
        onEnlargeRelated={vi.fn()}
      />,
    );
    expect(tabIds()).toEqual(['overview', RECORD_PAGE_TIMELINE_PANEL, 'task.lead_id', 'call.lead_id']);
    expect(document.querySelector('[data-record-tab-more]')?.textContent).toBe('+1');
  });

  it('each panel tab carries its count — the hidden ones counted too — and 动态 the stream\'s size', async () => {
    const find = vi.fn(async (objectName: string) => ({ data: [{ id: 'x' }], total: objectName === 'task' ? 2 : objectName === 'note' ? 0 : 5 }));
    const dataSource = { find, getObjectSchema: vi.fn(async () => ({ fields: {} })) };
    const stored = editRelatedArrangement(DEFAULT, undefined, { kind: 'hide', id: 'call.lead_id' }, Date.now());
    render(
      <RecordContextProvider objectName="lead" recordId="lead-1" dataSource={dataSource as any}>
        <RecordPageColumns
          tier="wide"
          columns={columnsOf()}
          relatedArrangement={stored}
          onRelatedArrangementChange={vi.fn()}
          onEnlargeRelated={vi.fn()}
          relatedFieldsOf={() => ({})}
        />
      </RecordContextProvider>,
    );
    await waitFor(() => expect(tabCount('task.lead_id')).toBe('2'));
    // The empty list's tab waits in the dropdown (objectstack#28469), beside the hidden one.
    expect(tabIds()).not.toContain('note.parent_id');
    expect(document.querySelector('[data-record-tab-more]')?.textContent).toBe('+2');
    expect(tabCount(RECORD_PAGE_TIMELINE_PANEL)).toBe('7');
    // The hidden panel was asked as well: its tab sits in the dropdown with its count.
    expect(find.mock.calls.map((call) => call[0]).sort()).toEqual(['call', 'note', 'task']);
    // One count set feeds the tabs and the panels: no relationship is read twice.
    expect(find).toHaveBeenCalledTimes(3);
  });

  it('a tab opens its panel\'s face; 概览 closes it', () => {
    const onEnlarge = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <RecordPageColumns tier="wide" columns={columnsOf()} onEnlargeRelated={onEnlarge} onCloseEnlargedRelated={onClose} />,
    );
    fireEvent.click(document.querySelector('[data-record-tab="task.lead_id"]')!);
    expect(onEnlarge).toHaveBeenCalledWith('task.lead_id');
    rerender(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        enlargedRelated="task.lead_id"
        onEnlargeRelated={onEnlarge}
        onCloseEnlargedRelated={onClose}
      />,
    );
    fireEvent.click(document.querySelector('[data-record-tab="overview"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('draws no row without a way to open a face, and none for a page with no panel', () => {
    render(<RecordPageColumns tier="wide" columns={columnsOf()} />);
    expect(document.querySelector('[data-record-tab-row]')).toBeNull();
    cleanup();
    const bare = buildDefaultPageColumns(buildDefaultPageSchema({ name: 'lead', fields: {} }, { hideDiscussion: true, hideAttachments: true }))!;
    render(<RecordPageColumns tier="wide" columns={bare} onEnlargeRelated={vi.fn()} />);
    expect(document.querySelector('[data-record-tab-row]')).toBeNull();
  });

  it('is drawn in the stack too: the narrow face keeps the row, not a tab tier', () => {
    render(<RecordPageColumns tier="stack" columns={columnsOf()} onEnlargeRelated={vi.fn()} />);
    expect(tabIds()).toEqual(['overview', RECORD_PAGE_TIMELINE_PANEL, ...DEFAULT]);
    expect(document.querySelector('[data-record-columns-shown="details"]')).not.toBeNull();
  });
});

describe('the enlarged state is the active tab (objectstack#27524, Target 9)', () => {
  it('the header and the row stay; the full table is drawn below the row, with no back line or title of its own', () => {
    const { container } = render(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        enlargedRelated="note.parent_id"
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={vi.fn()}
      />,
    );
    expect(activeTab()).toBe('note.parent_id');
    expect(container.querySelector('[data-node="page:header"]')).not.toBeNull();
    const face = container.querySelector('[data-related-enlarged="note.parent_id"]')!;
    expect(face.getAttribute('role')).toBe('tabpanel');
    expect(face.previousElementSibling).toBe(container.querySelector('[data-record-tab-row]'));
    expect(face.querySelector('[data-node="record:related_list"]')?.getAttribute('data-limit')).toBe('25');
    expect(face.querySelector('button, h2')).toBeNull();
    expect(container.querySelector('[data-record-columns]')).toBeNull();
  });

  it('the 动态 tab is the stream in full, and its tab carries the stream\'s size', async () => {
    const { container } = render(
      <RecordPageColumns
        tier="two-column"
        columns={columnsOf()}
        enlargedRelated={RECORD_PAGE_TIMELINE_PANEL}
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={vi.fn()}
      />,
    );
    expect(activeTab()).toBe(RECORD_PAGE_TIMELINE_PANEL);
    expect(container.querySelector(`[data-related-enlarged="${RECORD_PAGE_TIMELINE_PANEL}"] [data-node="record:activity"]`)).not.toBeNull();
    // Drawn in full, not as the panel's peek.
    expect(container.querySelector('[data-record-timeline-panel]')).toBeNull();
    await waitFor(() => expect(tabCount(RECORD_PAGE_TIMELINE_PANEL)).toBe('7'));
  });

  it('a body table open in place takes a tab of its own while it is open', () => {
    const columns = buildDefaultPageColumns(
      buildDefaultPageSchema(
        { name: 'quote', fields: { name: { type: 'text', label: 'Name' } } },
        {
          sections: [{ label: 'Basic', fields: ['name'] }],
          related: [{ objectName: 'quote_line_item', relationshipField: 'quote', title: 'Line items', isBody: true }, ...RELATED],
          hideDiscussion: true,
        },
      ),
    )!;
    expect(columns.details.some((n: any) => n.properties?.objectName === 'quote_line_item')).toBe(true);
    render(<RecordPageColumns tier="wide" columns={columns} onEnlargeRelated={vi.fn()} onCloseEnlargedRelated={vi.fn()} />);
    // Closed: a body table is no panel, so it has no tab.
    expect(tabIds()).not.toContain('quote_line_item.quote');
    cleanup();
    render(
      <RecordPageColumns
        tier="wide"
        columns={columns}
        enlargedRelated="quote_line_item.quote"
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={vi.fn()}
      />,
    );
    expect(tabIds().at(-1)).toBe('quote_line_item.quote');
    expect(activeTab()).toBe('quote_line_item.quote');
  });

  it('a link that opens another tab still names the 动态 count, counted from the feed the host holds (objectstack#27524)', async () => {
    // ③'s preview gate: opened on 任务, neither the 动态 panel nor its tab's
    // stream is drawn, and the stubbed stream reports nothing — the count
    // comes from the feed itself.
    const items = [
      { id: 'c1', type: 'comment', actor: 'Ada', body: 'hi', createdAt: '2026-10-30T10:00:00Z' },
      { id: 'c2', type: 'comment', actor: 'Ada', body: 'again', createdAt: '2026-10-30T11:00:00Z' },
      { id: 'a1', type: 'activity', actor: 'Ada', body: 'called', createdAt: '2026-10-29T09:00:00Z' },
    ];
    const { container } = render(
      <DiscussionContextProvider items={items as never} loading={false}>
        <RecordPageColumns
          tier="wide"
          columns={columnsOf()}
          enlargedRelated="task.lead_id"
          onEnlargeRelated={vi.fn()}
          onCloseEnlargedRelated={vi.fn()}
        />
      </DiscussionContextProvider>,
    );
    expect(activeTab()).toBe('task.lead_id');
    expect(container.querySelector('[data-node="record:activity"]')).toBeNull();
    await waitFor(() => expect(tabCount(RECORD_PAGE_TIMELINE_PANEL)).toBe('3'));
  });

  it('control: a feed still loading, or no feed held, names no 动态 count on another tab', async () => {
    render(
      <DiscussionContextProvider items={[]} loading>
        <RecordPageColumns
          tier="wide"
          columns={columnsOf()}
          enlargedRelated="task.lead_id"
          onEnlargeRelated={vi.fn()}
          onCloseEnlargedRelated={vi.fn()}
        />
      </DiscussionContextProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tabCount(RECORD_PAGE_TIMELINE_PANEL)).toBeNull();
    cleanup();
    render(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        enlargedRelated="task.lead_id"
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tabCount(RECORD_PAGE_TIMELINE_PANEL)).toBeNull();
  });

  it('the right column switched off names the 动态 count too', async () => {
    const items = [{ id: 'c1', type: 'comment', actor: 'Ada', body: 'hi', createdAt: '2026-10-30T10:00:00Z' }];
    const { container } = render(
      <DiscussionContextProvider items={items as never} loading={false}>
        <RecordPageColumns tier="wide" columns={columnsOf()} rightColumn={false} onEnlargeRelated={vi.fn()} />
      </DiscussionContextProvider>,
    );
    expect(container.querySelector('[data-record-column="right"]')).toBeNull();
    await waitFor(() => expect(tabCount(RECORD_PAGE_TIMELINE_PANEL)).toBe('1'));
  });

  it('Esc returns to 概览', () => {
    const onClose = vi.fn();
    render(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        enlargedRelated="task.lead_id"
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
