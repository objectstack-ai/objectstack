/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 → objectstack#27524, Target 6 — `RecordPageColumns`, the
 * synthesized record page laid out by one rule. The blocks themselves are
 * stubbed (each node draws its type, and reports the details column cap it
 * is drawn under), so what is measured here is the layout alone: where each
 * node lands, that the header is drawn once, the details pinned to a left
 * column beside the other tabs on a wide full page (objectstack#35890), and
 * that no width draws the right rail of summary cards any more.
 *
 * Two describes (objectstack#35253, objectstack#35483) opt each
 * `record:details` stub into mounting the `DetailView` the real block mounts
 * (`showHeader: false`, inline edit on), so the approval band it draws is
 * measured on the laid-out page; every other describe keeps the bare stub.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent, act } from '@testing-library/react';
import { RelatedCountStore } from '@object-ui/components';
import { RecordContextProvider } from '@object-ui/react';

const harness = vi.hoisted(() => ({
  /** Set by the objectstack#35253 describe: a `record:details` stub mounts `body`. */
  detailBodies: false,
  body: null as React.ComponentType<{ schema: any }> | null,
  /** The content width every element reports (jsdom lays nothing out). */
  width: 0,
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const { DetailsColumnCapContext } = await import('../defaultRecordPage');
  const Stub = ({ schema }: { schema: any }) => {
    const Body = harness.detailBodies && schema?.type === 'record:details' ? harness.body : null;
    return (
      <div data-node={schema?.type} data-cap={React.useContext(DetailsColumnCapContext)}>
        {schema?.properties?.objectName ?? schema?.type}
        {Body && <Body schema={schema} />}
      </div>
    );
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: Stub,
  };
});

import { RecordPageColumns } from '../RecordPageColumns';
import { buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
import { DetailView } from '../DetailView';
import { InlineEditProvider } from '@object-ui/react';

const page = buildDefaultPageSchema(
  { name: 'lead', label: 'Lead', fields: { name: { name: 'name', type: 'text' } } },
  {
    related: [
      { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
      { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
    ],
  },
);
const columns = buildDefaultPageColumns(page)!;

const column = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-record-column="${name}"]`) as HTMLElement | null;
const nodesIn = (el: HTMLElement | null) =>
  Array.from(el?.querySelectorAll('[data-node]') ?? []).map((n) => n.getAttribute('data-node'));
const grid = (container: HTMLElement) => container.querySelector('[data-record-columns]') as HTMLElement;
const tabNames = () => screen.queryAllByRole('tab').map((tab) => tab.getAttribute('data-record-tab'));

beforeEach(() => {
  harness.width = 0;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => harness.width);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RecordPageColumns — no right rail at any width (objectstack#35890 retires objectstack#35596)', () => {
  for (const tier of ['wide', 'two-column', 'stack'] as const) {
    it(`${tier}: one header, the details alone the full width, the footer closing them, no summary card`, () => {
      const { container } = render(
        <RecordPageColumns tier={tier} columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
      );
      expect(container.querySelector(`[data-record-page-tier="${tier}"]`)).not.toBeNull();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(container.querySelectorAll('[data-node="page:header"]')).toHaveLength(1);
      expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details');
      expect(grid(container).className).toContain('grid-cols-1');
      expect(column(container, 'right')).toBeNull();
      expect(container.querySelector('[data-record-summary-card]')).toBeNull();
      expect(nodesIn(column(container, 'details'))).toEqual(['record:details']);
      expect(column(container, 'details')!.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
      // The details alone take the row: a section's own width decides, up to three.
      expect(column(container, 'details')!.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('3');
    });
  }

  it('the retired `rightColumn` / `rail` props change nothing (the ⊟ switch went with the rail)', () => {
    const drawn = (props: Record<string, unknown>) => {
      const { container, unmount } = render(<RecordPageColumns tier="wide" columns={columns} {...props} />);
      const shown = grid(container).getAttribute('data-record-columns-shown');
      unmount();
      return shown;
    };
    expect([drawn({}), drawn({ rightColumn: false }), drawn({ rail: true }), drawn({ rail: false })]).toEqual([
      'details', 'details', 'details', 'details',
    ]);
  });

  it('a page with nothing but its details draws them alone; the footer closes them', () => {
    const bare = buildDefaultPageColumns(buildDefaultPageSchema({ name: 'thing', fields: {} }, { hideDiscussion: true }))!;
    harness.width = 1600;
    const { container } = render(
      <RecordPageColumns tier="wide" columns={bare} fullPage footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-pinned]')).toBeNull();
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details');
    expect(within(column(container, 'details')!).getByTestId('meta-footer')).toBeTruthy();
  });
});

describe('RecordPageColumns — the tab row follows the header (objectstack#35745)', () => {
  // Measured in the browser (1280, Expense Report): the header's bottom at 92,
  // the tab row at 140 — the host scroller's 24px top padding and this root's
  // 24px stacked. The host's scroller pads no top now (RecordDetailView), and
  // this root's top is 12px at every width; the sides and foot keep the page's.
  it("the root's top padding is 12px at every width, its sides and foot the page's", () => {
    const { container } = render(<RecordPageColumns tier="wide" columns={columns} />);
    const root = container.querySelector('[data-page-type="record"]')!;
    const classes = root.className.split(/\s+/);
    expect(classes).toContain('pt-3');
    expect(classes.filter((c) => /^(?:\w+:)?(?:p|pt|py)-/.test(c) && c !== 'pt-3')).toEqual([]);
    expect(classes).toEqual(expect.arrayContaining(['px-3', 'md:px-4', 'lg:px-6', 'pb-3', 'md:pb-4', 'lg:pb-6']));
  });
});

/**
 * objectstack#35890 (figure 41) — on a full page with room for a 320 px left
 * column and 400 px of tabs, the details are pinned left and the other tabs
 * sit beside them, open on the first; the left column is 400 px, dragged by
 * the reader, and narrows on its own to leave the tabs 400.
 */
describe('RecordPageColumns — the details pinned left on a wide full page (objectstack#35890)', () => {
  beforeEach(() => RelatedCountStore._reset());
  const find = vi.fn(async () => ({ data: [], total: 0 }));
  let draws = 0;
  const drawPage = (cols: typeof columns, extra: Record<string, unknown> = {}) => {
    const onEnlargeRelated = vi.fn();
    const utils = render(
      <RecordContextProvider
        objectName="lead"
        recordId={`lead-${++draws}`}
        dataSource={{ find, getObjectSchema: vi.fn(async () => ({ fields: {} })) } as any}
      >
        <RecordPageColumns
          tier="wide"
          columns={cols}
          fullPage
          onEnlargeRelated={onEnlargeRelated}
          footer={<p data-testid="meta-footer">meta</p>}
          {...extra}
        />
      </RecordContextProvider>,
    );
    return { ...utils, onEnlargeRelated };
  };

  it('pins: details left at 400 px, one field a row; beside them the tabs without 「详情」, open on the first list', () => {
    harness.width = 1184;
    const { container } = drawPage(columns);
    expect(container.querySelector('[data-record-page-pinned]')).not.toBeNull();
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details tabs');
    expect(grid(container).style.gridTemplateColumns).toBe('400px 24px minmax(0,1fr)');
    const details = column(container, 'details')!;
    expect(nodesIn(details)).toEqual(['record:details']);
    expect(details.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('1');
    expect(details.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    // The tab row is beside the details, never above both; 「详情」 is not a tab.
    const tabs = column(container, 'tabs')!;
    expect(within(tabs).getByRole('tablist')).toBeTruthy();
    expect(tabNames()).toEqual(['task.lead_id', 'note.parent_id', 'timeline']);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('data-record-tab')).toBe('task.lead_id');
    expect(tabs.querySelector('[data-related-enlarged="task.lead_id"]')).not.toBeNull();
    expect(nodesIn(tabs)).toContain('record:related_list');
    // Nothing is drawn twice, and there is no rail.
    expect(container.querySelectorAll('[data-node="record:details"]')).toHaveLength(1);
    expect(container.querySelector('[data-record-summary-card]')).toBeNull();
  });

  it('opens on the address\'s tab when it names one; choosing the implied tab writes nothing', () => {
    harness.width = 1184;
    const { container, onEnlargeRelated, unmount } = drawPage(columns, { enlargedRelated: 'timeline' });
    expect(screen.getByRole('tab', { selected: true }).getAttribute('data-record-tab')).toBe('timeline');
    expect(column(container, 'tabs')!.querySelector('[data-related-enlarged="timeline"]')).not.toBeNull();
    unmount();
    const second = drawPage(columns);
    fireEvent.click(screen.getByRole('tab', { name: /Tasks/ }));
    expect(second.onEnlargeRelated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: /Notes/ }));
    expect(second.onEnlargeRelated).toHaveBeenCalledWith('note.parent_id');
    expect(onEnlargeRelated).not.toHaveBeenCalled();
  });

  it('with no related list, the first other tab is 动态', () => {
    harness.width = 1184;
    const noLists = buildDefaultPageColumns(buildDefaultPageSchema({ name: 'thing', fields: {} }))!;
    drawPage(noLists);
    expect(tabNames()).toEqual(['timeline']);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('data-record-tab')).toBe('timeline');
  });

  it('the left column narrows on its own to leave the tabs 400, down to 320; under that the page does not pin', () => {
    harness.width = 744 + 80;
    const { container, unmount } = drawPage(columns);
    expect(grid(container).style.gridTemplateColumns).toBe('400px 24px minmax(0,1fr)');
    unmount();
    harness.width = 800;
    const narrower = drawPage(columns);
    expect(grid(narrower.container).style.gridTemplateColumns).toBe('376px 24px minmax(0,1fr)');
    narrower.unmount();
    harness.width = 744;
    const least = drawPage(columns);
    expect(grid(least.container).style.gridTemplateColumns).toBe('320px 24px minmax(0,1fr)');
    least.unmount();
    // CONTROL: one pixel less and the details are the first tab again.
    harness.width = 743;
    const tabbed = drawPage(columns);
    expect(tabbed.container.querySelector('[data-record-page-pinned]')).toBeNull();
    expect(tabNames()[0]).toBe('overview');
  });

  it('the reader\'s dragged width holds, clamped the same way; the handle moves it by keyboard', () => {
    harness.width = 1184;
    const onDetailsWidthChange = vi.fn();
    const { container } = drawPage(columns, { detailsWidth: 520, onDetailsWidthChange });
    expect(grid(container).style.gridTemplateColumns).toBe('520px 24px minmax(0,1fr)');
    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-valuenow')).toBe('520');
    expect(handle.getAttribute('aria-valuemin')).toBe('320');
    expect(handle.getAttribute('aria-valuemax')).toBe(String(1184 - 24 - 400));
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onDetailsWidthChange).toHaveBeenLastCalledWith(536);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onDetailsWidthChange).toHaveBeenLastCalledWith(320);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onDetailsWidthChange).toHaveBeenLastCalledWith(760);
  });

  it('a drag previews and keeps the width once it ends', () => {
    harness.width = 1184;
    const onDetailsWidthChange = vi.fn();
    const { container } = drawPage(columns, { onDetailsWidthChange });
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { button: 0, clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 460, pointerId: 1 });
    expect(grid(container).style.gridTemplateColumns).toBe('460px 24px minmax(0,1fr)');
    expect(onDetailsWidthChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 460, pointerId: 1 });
    expect(onDetailsWidthChange).toHaveBeenCalledWith(460);
  });

  it('a drawer or pane (no `fullPage`) never pins: the details stay its first tab', () => {
    harness.width = 1600;
    const { container } = drawPage(columns, { fullPage: false });
    expect(container.querySelector('[data-record-page-pinned]')).toBeNull();
    expect(tabNames()).toEqual(['overview', 'task.lead_id', 'note.parent_id', 'timeline']);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('data-record-tab')).toBe('overview');
  });

  it('a page whose field groups place a related table among the fields does not pin (objectstack#35889)', () => {
    harness.width = 1600;
    const withBody = buildDefaultPageColumns(
      buildDefaultPageSchema(
        { name: 'quote', label: 'Quote', fields: { name: { name: 'name', type: 'text' } } },
        { related: [{ objectName: 'quote_line', relationshipField: 'quote_id', title: 'Lines', isPrimary: true }] },
      ),
    )!;
    const { container } = drawPage(withBody);
    expect(container.querySelector('[data-record-page-pinned]')).toBeNull();
    expect(tabNames()[0]).toBe('overview');
  });

  it('narrowed out of the pinned layout, the implied tab goes into the address (replacing), so it stays open', async () => {
    const observed: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { observed.push(callback); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    harness.width = 1184;
    const { onEnlargeRelated } = drawPage(columns);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('data-record-tab')).toBe('task.lead_id');
    harness.width = 700;
    act(() => observed.forEach((measure) => measure()));
    await waitFor(() => expect(onEnlargeRelated).toHaveBeenCalledWith('task.lead_id', { replace: true }));
    expect(onEnlargeRelated).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('tells the host which tab is on screen, implied or addressed', () => {
    harness.width = 1184;
    const onShownTabChange = vi.fn();
    drawPage(columns, { onShownTabChange });
    expect(onShownTabChange).toHaveBeenLastCalledWith('task.lead_id');
    cleanup();
    harness.width = 0;
    drawPage(columns, { onShownTabChange });
    expect(onShownTabChange).toHaveBeenLastCalledWith('overview');
  });
});

/**
 * objectstack#35253 — one approval band per record page. The synthesized page
 * splits its details around a body table (`relatedList: 'primary'`, a
 * quote's line items), so the details column holds two `record:details`
 * nodes; each mounts a `DetailView` with its own header suppressed, and each
 * of those drew the band — "Locked for approval" above the table and again
 * above the next section. The card's Expected: one lock chip per record page,
 * however many body sections the synthesized page splits the details into.
 *
 * The band stays with the FIRST details part (above the table). The lock
 * rule itself is untouched: a `lockRecord: false` node still reads as an
 * editable approval, never as locked, and it too is drawn once.
 */
describe('RecordPageColumns — the approval band is drawn once per page (objectstack#35253)', () => {
  /** What `record:details` mounts: its own header off, inline edit on (`renderers/record-details`). */
  const Body = () => (
    <DetailView
      schema={{ type: 'detail-view', objectName: 'quote', showHeader: false, data: { id: 'Q1', name: 'Q-1' }, sections: [] } as any}
      inlineEdit
      recordFromHost
    />
  );
  beforeEach(() => {
    harness.detailBodies = true;
    harness.body = Body;
  });
  afterEach(() => {
    harness.detailBodies = false;
    harness.body = null;
  });

  // The `lines` group positions the body table between the two sections
  // (objectstack#35597 draws an unplaced body table above every section, so
  // the split this suite pins is the group-placed one).
  const quote = {
    name: 'quote',
    fields: {
      name: { type: 'text', label: 'Name', group: 'basic' },
      terms: { type: 'textarea', label: 'Terms', group: 'terms' },
    },
    fieldGroups: [{ key: 'basic' }, { key: 'lines', relatedList: 'quote_line_item' }, { key: 'terms' }],
  };
  const SECTIONS = [
    { name: 'basic', label: 'Basic', fields: ['name'] },
    { name: 'terms', label: 'Terms', fields: ['terms'] },
  ];
  const LINES = { objectName: 'quote_line_item', relationshipField: 'quote', title: 'Line items', isPrimary: true };
  const split = buildDefaultPageColumns(buildDefaultPageSchema(quote, { sections: SECTIONS, related: [LINES] }))!;
  const whole = buildDefaultPageColumns(buildDefaultPageSchema(quote, { sections: SECTIONS }))!;

  const drawPage = (
    tier: 'wide' | 'two-column' | 'stack',
    columns: typeof split,
    approval: { locked?: boolean; approvalPending?: boolean },
  ) =>
    render(
      <InlineEditProvider canEdit={false} {...approval}>
        <RecordPageColumns tier={tier} columns={columns} />
      </InlineEditProvider>,
    );

  it('the split page carries two details parts around the body table', () => {
    expect(split.details.map((n: any) => n.type)).toEqual(['record:details', 'record:related_list', 'record:details']);
  });

  for (const tier of ['wide', 'two-column', 'stack'] as const) {
    it(`${tier}: a locked record split around its body table draws "Locked for approval" once, above the table`, () => {
      const { container } = drawPage(tier, split, { locked: true });
      const details = column(container, 'details')!;
      expect(details.querySelectorAll('[data-node="record:details"]')).toHaveLength(2);
      const chips = screen.getAllByText('Locked for approval');
      expect(chips).toHaveLength(1);
      const table = details.querySelector('[data-node="record:related_list"]')!;
      expect(chips[0].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }

  it('CONTROL: a page with one details part still draws its one chip', () => {
    const { container } = drawPage('wide', whole, { locked: true });
    expect(column(container, 'details')!.querySelectorAll('[data-node="record:details"]')).toHaveLength(1);
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
  });

  it('CONTROL: an authored page\'s one details body (no laid-out page around it) still draws its one chip', () => {
    render(
      <InlineEditProvider canEdit={false} locked>
        <Body />
      </InlineEditProvider>,
    );
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
  });

  it('CONTROL: a record with no approval running draws no band on the split page', () => {
    drawPage('wide', split, {});
    expect(screen.queryByText('Locked for approval')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a `lockRecord: false` approval on the split page reads as editable, once — never as locked', () => {
    render(
      <InlineEditProvider canEdit approvalPending locked={false}>
        <RecordPageColumns tier="wide" columns={split} />
      </InlineEditProvider>,
    );
    expect(screen.queryByText('Locked for approval')).toBeNull();
    expect(screen.getAllByText('In approval · editable')).toHaveLength(1);
  });
});

/**
 * objectstack#35483 / objectstack#35484 — the band is not dropped when the
 * FIRST details part draws no body. A slotted page's `details` slot places the
 * author's own `record:details` nodes in the laid-out details column; the first
 * may draw no band of its own: its `requiredPermissions` withheld (the real
 * block draws its insufficient-permissions notice in place of the body,
 * `record-blocks.requiredPermissions-gate.test.tsx`) or `showHeader: true`
 * (the body draws its own header, and no band). The column draws the band once
 * by the first body that reaches its place (`ApprovalBandOnceScope`), so the
 * next part draws it. Before, every part after the first was told not to draw
 * it and such a page showed no band at all, on a locked record.
 */
describe('RecordPageColumns — a first details part that draws no band leaves it to the next (objectstack#35483, objectstack#35484)', () => {
  /** What `record:details` mounts for its node: the notice when withheld, else its body. */
  const PartBody = ({ schema }: { schema: any }) => {
    const p = { ...schema, ...(schema?.properties ?? {}) };
    if (Array.isArray(p.requiredPermissions) && p.requiredPermissions.length > 0) {
      return <p role="status">Insufficient permissions to view details.</p>;
    }
    return (
      <DetailView
        schema={{ type: 'detail-view', objectName: 'quote', showHeader: p.showHeader ?? false, data: { id: 'Q1', name: 'Q-1' }, sections: [] } as any}
        inlineEdit
        recordFromHost
      />
    );
  };
  beforeEach(() => {
    harness.detailBodies = true;
    harness.body = PartBody;
  });
  afterEach(() => {
    harness.detailBodies = false;
    harness.body = null;
  });

  const quote = { name: 'quote', fields: { name: { type: 'text', label: 'Name' }, terms: { type: 'textarea', label: 'Terms' } } };
  const part = (id: string, props: Record<string, unknown> = {}) => ({
    type: 'record:details',
    id,
    properties: { sections: [{ name: id, label: id, fields: [id === 'first' ? 'name' : 'terms'] }], ...props },
  });
  const slotted = (details: any[]) => buildDefaultPageColumns(buildDefaultPageSchema(quote, { slots: { details } } as any))!;
  const drawPage = (columns: ReturnType<typeof slotted>, approval: { locked?: boolean; approvalPending?: boolean; canEdit?: boolean }) =>
    render(
      <InlineEditProvider canEdit={approval.canEdit ?? false} locked={approval.locked} approvalPending={approval.approvalPending}>
        <RecordPageColumns tier="wide" columns={columns} />
      </InlineEditProvider>,
    );
  /** The details parts (by node id) whose subtree shows `text`. */
  const partsShowing = (container: HTMLElement, text: string) =>
    Array.from(column(container, 'details')!.querySelectorAll('[data-node="record:details"]'))
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.textContent?.includes(text))
      .map(({ index }) => index);

  it('the slotted page lays its two details nodes out in the details column', () => {
    expect(slotted([part('first'), part('second')]).details.map((n: any) => n.id)).toEqual(['first', 'second']);
  });

  for (const [why, props] of [
    ['withheld by its requiredPermissions', { requiredPermissions: ['quote.audit'] }],
    ['drawing its own header', { showHeader: true }],
  ] as const) {
    it(`a first part ${why}: "Locked for approval" once, on the second part`, () => {
      const { container } = drawPage(slotted([part('first', props), part('second')]), { locked: true });
      expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
      expect(partsShowing(container, 'Locked for approval')).toEqual([1]);
    });
  }

  it('a `lockRecord: false` approval behind a withheld first part reads editable, once — never locked', () => {
    drawPage(slotted([part('first', { requiredPermissions: ['quote.audit'] }), part('second')]), { approvalPending: true, locked: false, canEdit: true });
    expect(screen.queryByText('Locked for approval')).toBeNull();
    expect(screen.getAllByText('In approval · editable')).toHaveLength(1);
  });

  it('CONTROL: two drawing parts keep the band on the first, once', () => {
    const { container } = drawPage(slotted([part('first'), part('second')]), { locked: true });
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
    expect(partsShowing(container, 'Locked for approval')).toEqual([0]);
  });

  it('CONTROL: a single slotted details part draws its one band', () => {
    drawPage(slotted([part('first')]), { locked: true });
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
  });

  it('CONTROL: a single withheld part draws no band and no body (nothing on the page reaches its place)', () => {
    drawPage(slotted([part('first', { requiredPermissions: ['quote.audit'] })]), { locked: true });
    expect(screen.queryByText('Locked for approval')).toBeNull();
    expect(screen.getByText('Insufficient permissions to view details.')).toBeTruthy();
  });
});
