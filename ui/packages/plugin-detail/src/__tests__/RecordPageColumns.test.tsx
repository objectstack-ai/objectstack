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
 * node lands, that the header is drawn once, the 概览 tab's rail in the right
 * column and its order (objectstack#35596, re-setting objectstack#34590), and
 * each tier's measures.
 *
 * One describe (objectstack#35253) opts each `record:details` stub into
 * mounting the `DetailView` the real block mounts (`showHeader: false`,
 * inline edit on), so the approval band it draws is measured on the laid-out
 * page; every other describe keeps the bare stub.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import { RelatedCountStore } from '@object-ui/components';
import { RecordContextProvider } from '@object-ui/react';

const harness = vi.hoisted(() => ({
  /** Set by the objectstack#35253 describe: a `record:details` stub mounts `body`. */
  detailBodies: false,
  body: null as React.ComponentType | null,
  /** Set by the objectstack#35596 describe: the size a stream block reports. */
  timelineCount: undefined as number | undefined,
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const { DetailsColumnCapContext } = await import('../defaultRecordPage');
  const { RecordTimelinePanelContext } = await import('../recordTimelineStream');
  const Stub = ({ schema }: { schema: any }) => {
    const Body = harness.detailBodies && schema?.type === 'record:details' ? harness.body : null;
    // objectstack#35596 — a stream block in the rail's 最近动态 card reports
    // the stream's size, as the real one does.
    const panel = React.useContext(RecordTimelinePanelContext);
    React.useEffect(() => {
      if (schema?.type === 'record:activity' && panel && harness.timelineCount !== undefined) panel.onCount(harness.timelineCount);
    }, [panel, schema?.type]);
    return (
      <div data-node={schema?.type} data-cap={React.useContext(DetailsColumnCapContext)}>
        {schema?.properties?.objectName ?? schema?.type}
        {Body && <Body />}
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
import { buildDefaultHighlights, buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
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

afterEach(() => cleanup());

describe('RecordPageColumns — details | the right column (objectstack#27524, Target 6)', () => {
  it('wide (≥ 1120): one header, details | right column at 380 px holding the rail, no tab strip without a host', () => {
    const { container } = render(
      <RecordPageColumns tier="wide" columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-tier="wide"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.querySelectorAll('[data-node="page:header"]')).toHaveLength(1);
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
    expect(grid(container).className).toContain('grid-cols-[minmax(0,1fr)_23.75rem]');
    expect(nodesIn(column(container, 'details'))).toEqual(['record:details']);
    // objectstack#35596 — the right column is the 概览 tab's rail: summary
    // cards, never a related list drawn whole (the lists are tabs,
    // objectstack#35595). With no counts read, only the 最近动态 card is
    // mounted, hidden until the stream reports entries.
    const right = column(container, 'right')!;
    expect(right.querySelector('[data-node="record:related_list"]')).toBeNull();
    expect(nodesIn(right)).toEqual(['record:activity']);
    expect((right.querySelector('[data-record-summary-card="timeline"]') as HTMLElement).hidden).toBe(true);
    // No timeline column exists any more (「动态是面板，不是栏」).
    expect(column(container, 'timeline')).toBeNull();
    // The meta line closes the details column (objectstack#27055).
    expect(within(right).queryByTestId('meta-footer')).toBeNull();
    expect(column(container, 'details')!.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    // Wide: a details section may take three field columns.
    expect(column(container, 'details')!.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('3');
  });

  it('two-column (760 – 1119): the right column at 320 px holding the rail — no toggle', () => {
    const { container } = render(<RecordPageColumns tier="two-column" columns={columns} />);
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
    expect(grid(container).className).toContain('grid-cols-[minmax(0,1fr)_20rem]');
    // objectstack#35596 — the rail's cards, not the lists themselves.
    expect(nodesIn(column(container, 'right'))).toEqual(['record:activity']);
    expect(screen.queryByRole('button', { name: /Related/ })).toBeNull();
    expect(container.querySelector('[data-testid="record-related-rail-toggle"]')).toBeNull();
    // Beside the 320 px column a details section takes two field columns at most.
    expect(column(container, 'details')!.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('2');
  });

  it('a page with nothing for the right column draws the details alone; the footer closes them', () => {
    const bare = buildDefaultPageColumns(buildDefaultPageSchema({ name: 'thing', fields: {} }, { hideDiscussion: true }))!;
    const { container } = render(
      <RecordPageColumns tier="wide" columns={bare} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(column(container, 'details')).not.toBeNull();
    expect(column(container, 'right')).toBeNull();
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

describe('RecordPageColumns — the stack (< 760, objectstack#27524, Target 6)', () => {
  it('ONE column: the details and their footer, then the rail — no tabs without a host', () => {
    const { container } = render(
      <RecordPageColumns tier="stack" columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-tier="stack"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details');
    expect(grid(container).className).toContain('grid-cols-1');
    // Details first, the panels after them, in one flow.
    const [details, right] = Array.from(grid(container).children) as HTMLElement[];
    expect(details.getAttribute('data-record-column')).toBe('details');
    expect(right.getAttribute('data-record-column')).toBe('right');
    expect(details.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    // objectstack#35596 — the rail's cards, under the details.
    expect(nodesIn(right)).toEqual(['record:activity']);
    // The stack's details are the whole width: the section's own container decides.
    expect(details.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('3');
  });
});

/**
 * objectstack#35596 — the 概览 tab's right rail summarizes the other tabs, in
 * a fixed order: 审批, 附件, 最近动态, then 「其他相关」 (one card per related
 * list that has records). This re-sets objectstack#34590's column order (the
 * related panels, then 动态 last): the related lists are tabs now
 * (objectstack#35595), and the rail draws a card only for a tab that has
 * something to show. The stack draws the same rail under the details.
 */
describe('RecordPageColumns — the rail: 审批, 附件, 最近动态, 其他相关 (objectstack#35596, re-setting objectstack#34590)', () => {
  beforeEach(() => {
    RelatedCountStore._reset();
    harness.timelineCount = 4;
  });
  afterEach(() => {
    harness.timelineCount = undefined;
  });
  const relatedLists = [
    { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
    { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
    { objectName: 'call', relationshipField: 'lead_id', title: 'Calls' },
  ];
  const PENDING = {
    approvals: {
      available: true,
      requests: [{ id: 'req_1' }],
      pendingRequest: { id: 'req_1', step_label: 'Manager review', pending_approvers: ['u2'], pending_approver_names: { u2: 'Wang' } },
    },
  };
  const synth = (opts: { files: boolean; approvals: boolean }) =>
    buildDefaultPageColumns(
      buildDefaultPageSchema(
        {
          name: 'lead',
          label: 'Lead',
          fields: { name: { name: 'name', type: 'text' } },
          ...(opts.files ? { enable: { files: true } } : {}),
        },
        { related: relatedLists, ...(opts.approvals ? { approvals: { count: 1, node: PENDING } } : {}) },
      ),
    )!;
  /** task 0 and call 0 are empty; note has 2; the record holds 5 files. */
  const TOTALS: Record<string, number> = { task: 0, note: 2, call: 0, sys_attachment: 5 };
  const find = vi.fn(async (objectName: string) => ({
    data: TOTALS[objectName] ? [{ id: `${objectName}-1`, name: `${objectName} one` }] : [],
    total: TOTALS[objectName] ?? 0,
  }));
  // A record of its own per draw: the count hook keeps a parent's first set.
  let draws = 0;
  const drawPage = (tier: 'wide' | 'two-column' | 'stack', cols: ReturnType<typeof synth>, extra: Record<string, unknown> = {}) =>
    render(
      <RecordContextProvider
        objectName="lead"
        recordId={`lead-${++draws}`}
        dataSource={{ find, getObjectSchema: vi.fn(async () => ({ fields: {} })) } as any}
      >
        <RecordPageColumns tier={tier} columns={cols} footer={<p data-testid="meta-footer">meta</p>} {...extra} />
      </RecordContextProvider>,
    );
  /** The rail's cards as drawn (a `hidden` card is not drawn), in document order. */
  const cards = (container: HTMLElement) =>
    Array.from(column(container, 'right')?.querySelectorAll('[data-record-summary-card]') ?? [])
      .filter((el) => !(el as HTMLElement).hidden)
      .map((el) => el.getAttribute('data-record-summary-card'));

  const cases = [
    { files: false, approvals: false },
    { files: true, approvals: false },
    { files: false, approvals: true },
    { files: true, approvals: true },
  ];
  for (const tier of ['wide', 'two-column', 'stack'] as const) {
    for (const opts of cases) {
      it(`${tier}, attachments ${opts.files ? 'on' : 'off'}, approvals ${opts.approvals ? 'on' : 'off'}: the rail's order`, async () => {
        const { container } = drawPage(tier, synth(opts));
        const expected = [
          ...(opts.approvals ? ['approvals'] : []),
          ...(opts.files ? ['attachments'] : []),
          'timeline',
          'note.parent_id',
        ];
        await waitFor(() => expect(cards(container)).toEqual(expected));
        // 「其他相关」 heads the related cards, after 最近动态.
        const other = column(container, 'right')!.querySelector('[data-record-summary-other]')!;
        const timeline = column(container, 'right')!.querySelector('[data-record-summary-card="timeline"]')!;
        expect(timeline.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // No related list is drawn whole in the rail: the lists are tabs.
        expect(column(container, 'right')!.querySelector('[data-node="record:related_list"]')).toBeNull();
        if (tier === 'stack') {
          const [details, rail] = Array.from(grid(container).children) as HTMLElement[];
          expect(details.getAttribute('data-record-column')).toBe('details');
          expect(rail.getAttribute('data-record-column')).toBe('right');
          expect(details.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
        } else {
          expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
        }
      });
    }
  }

  it('an empty card is absent, and nothing stands in for the empty lists (no 「还有 N 个空关联」)', async () => {
    const { container } = drawPage('wide', synth({ files: false, approvals: false }));
    await waitFor(() => expect(cards(container)).toContain('note.parent_id'));
    expect(cards(container)).not.toContain('task.lead_id');
    expect(cards(container)).not.toContain('call.lead_id');
    expect(container.querySelector('[data-related-empty-fold]')).toBeNull();
    expect(container.textContent).not.toMatch(/还有\s*\d+\s*个空关联|more empty/i);
  });

  it('CONTROL: a stream with no entries draws no 最近动态 card; the same page with entries does', async () => {
    harness.timelineCount = 0;
    const { container, unmount } = drawPage('wide', synth({ files: false, approvals: false }));
    await waitFor(() => expect(cards(container)).toEqual(['note.parent_id']));
    unmount();
    harness.timelineCount = 4;
    RelatedCountStore._reset();
    const again = drawPage('wide', synth({ files: false, approvals: false }));
    await waitFor(() => expect(cards(again.container)).toEqual(['timeline', 'note.parent_id']));
  });

  it('a card shows at most three rows, a grey count after its 14 px title, rows 26 px high, radius 8', async () => {
    TOTALS.note = 9;
    find.mockImplementation(async (objectName: string) => ({
      data: Array.from({ length: Math.min(TOTALS[objectName] ?? 0, 5) }, (_, i) => ({ id: `${objectName}-${i}`, name: `${objectName} ${i}` })),
      total: TOTALS[objectName] ?? 0,
    }));
    try {
      const { container } = drawPage('wide', synth({ files: false, approvals: false }));
      const card = () => container.querySelector('[data-record-summary-card="note.parent_id"]') as HTMLElement | null;
      await waitFor(() => expect(card()?.querySelectorAll('[data-record-summary-row]').length).toBe(3));
      expect(card()!.className).toContain('rounded-[8px]');
      const title = card()!.querySelector('[data-record-summary-card-title]')!;
      expect(title.className).toContain('text-sm');
      const count = title.querySelector('[data-record-summary-card-count]')!;
      expect(count.textContent).toBe('9');
      expect(count.className).toContain('text-muted-foreground');
      expect(card()!.querySelector('[data-record-summary-row]')!.className).toContain('h-[26px]');
    } finally {
      TOTALS.note = 2;
      find.mockImplementation(async (objectName: string) => ({
        data: TOTALS[objectName] ? [{ id: `${objectName}-1`, name: `${objectName} one` }] : [],
        total: TOTALS[objectName] ?? 0,
      }));
    }
  });

  it('the whole title opens its tab', async () => {
    const onEnlargeRelated = vi.fn();
    const { container } = drawPage('wide', synth({ files: true, approvals: true }), { onEnlargeRelated });
    await waitFor(() => expect(cards(container)).toEqual(['approvals', 'attachments', 'timeline', 'note.parent_id']));
    for (const id of ['approvals', 'attachments', 'timeline', 'note.parent_id']) {
      fireEvent.click(container.querySelector(`[data-record-summary-card="${id}"] [data-record-summary-card-title]`)!);
      expect(onEnlargeRelated).toHaveBeenLastCalledWith(id);
    }
  });

  it('the rail is the 概览 tab\'s: another tab open draws none, and the strip leaves with it', async () => {
    // A slotted page placing the strip: the default page draws none since
    // objectstack#35891, and the columns still draw a placed one on 概览.
    const lead = { name: 'lead', fields: { name: { type: 'text' }, email: { type: 'email' }, rating: { type: 'select' } } } as any;
    const cols = buildDefaultPageColumns(
      buildDefaultPageSchema(lead, {
        related: relatedLists,
        slots: {
          highlights: buildDefaultHighlights(lead, {
            highlightFields: ['email'],
            statusField: 'rating',
            stages: [{ value: 'hot', label: 'Hot' }],
          }),
        },
      }),
    )!;
    expect(cols.strip.length).toBeGreaterThan(0);
    const overview = drawPage('wide', cols, { onEnlargeRelated: vi.fn() });
    // CONTROL: on 概览 the rail and the strip are drawn, the strip above the columns.
    expect(column(overview.container, 'right')).not.toBeNull();
    const strip = overview.container.querySelector('[data-record-overview-strip]')!;
    expect(strip).not.toBeNull();
    expect(strip.compareDocumentPosition(grid(overview.container)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grid(overview.container).contains(strip)).toBe(false);
    overview.unmount();
    const other = drawPage('wide', cols, { onEnlargeRelated: vi.fn(), enlargedRelated: 'note.parent_id' });
    expect(column(other.container, 'right')).toBeNull();
    expect(other.container.querySelector('[data-record-summary-card]')).toBeNull();
    expect(other.container.querySelector('[data-record-overview-strip]')).toBeNull();
    expect(other.container.querySelector('[data-node="record:highlights"]')).toBeNull();
    expect(other.container.querySelector('[data-node="record:path"]')).toBeNull();
  });

  it('a rail with nothing to show takes no column once every count is in; CONTROL: one list with records keeps it', async () => {
    harness.timelineCount = 0;
    TOTALS.note = 0;
    try {
      const { container, unmount } = drawPage('wide', synth({ files: false, approvals: false }));
      await waitFor(() => expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details'));
      expect(column(container, 'right')).toBeNull();
      unmount();
    } finally {
      TOTALS.note = 2;
    }
    RelatedCountStore._reset();
    const again = drawPage('wide', synth({ files: false, approvals: false }));
    await waitFor(() => expect(cards(again.container)).toEqual(['note.parent_id']));
    expect(grid(again.container).getAttribute('data-record-columns-shown')).toBe('details right');
  });

  it('a drawer draws no rail (`rail={false}`): the details alone, the tabs carry the rest', () => {
    const { container } = drawPage('wide', synth({ files: true, approvals: true }), { rail: false });
    expect(column(container, 'right')).toBeNull();
    expect(container.querySelector('[data-record-summary-card]')).toBeNull();
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details');
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
