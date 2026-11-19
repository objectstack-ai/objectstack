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
 * node lands, that the header is drawn once, that no tab strip and no rail
 * exist, the 动态 panel closing the right column (objectstack#34590), and each
 * tier's measures.
 *
 * One describe (objectstack#35253) opts each `record:details` stub into
 * mounting the `DetailView` the real block mounts (`showHeader: false`,
 * inline edit on), so the approval band it draws is measured on the laid-out
 * page; every other describe keeps the bare stub.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const harness = vi.hoisted(() => ({
  /** Set by the objectstack#35253 describe: a `record:details` stub mounts `body`. */
  detailBodies: false,
  body: null as React.ComponentType | null,
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const { DetailsColumnCapContext } = await import('../defaultRecordPage');
  const Stub = ({ schema }: { schema: any }) => {
    const Body = harness.detailBodies && schema?.type === 'record:details' ? harness.body : null;
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
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
import { relatedDefaultOrderHash } from '../synth/relatedArrangement';
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
  it('wide (≥ 1120): one header, details | right column at 380 px, 动态 last (objectstack#34590), no tab strip', () => {
    const { container } = render(
      <RecordPageColumns tier="wide" columns={columns} footer={<p data-testid="meta-footer">meta</p>} />,
    );
    expect(container.querySelector('[data-record-page-tier="wide"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.querySelectorAll('[data-node="page:header"]')).toHaveLength(1);
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
    expect(grid(container).className).toContain('grid-cols-[minmax(0,1fr)_23.75rem]');
    expect(nodesIn(column(container, 'details'))).toEqual(['record:details']);
    // objectstack#34590 — the related panels lead the right column; the 动态
    // panel closes it (supersedes objectstack#27524 Targets 5 and 8's
    // 动态-first for the column).
    const right = column(container, 'right')!;
    expect(right.lastElementChild?.hasAttribute('data-record-timeline-panel')).toBe(true);
    expect(nodesIn(right)).toEqual(['record:related_list', 'record:related_list', 'record:activity']);
    // No timeline column exists any more (「动态是面板，不是栏」).
    expect(column(container, 'timeline')).toBeNull();
    // The meta line closes the details column (objectstack#27055).
    expect(within(right).queryByTestId('meta-footer')).toBeNull();
    expect(column(container, 'details')!.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
    // The related lists are siblings of one parent, so they form one empty-fold stack.
    const lists = right.querySelectorAll('[data-node="record:related_list"]');
    expect(lists[0].parentElement).toBe(lists[1].parentElement);
    // Wide: a details section may take three field columns.
    expect(column(container, 'details')!.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('3');
  });

  it('two-column (760 – 1119): the right column at 320 px, its lists resident — no rail, no toggle', () => {
    const { container } = render(<RecordPageColumns tier="two-column" columns={columns} />);
    expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
    expect(grid(container).className).toContain('grid-cols-[minmax(0,1fr)_20rem]');
    // objectstack#34590 — 动态 last (supersedes objectstack#27524 Targets 5 and 8 for the column).
    expect(nodesIn(column(container, 'right'))).toEqual(['record:related_list', 'record:related_list', 'record:activity']);
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

describe('RecordPageColumns — the stack (< 760, objectstack#27524, Target 6)', () => {
  it('ONE column: the details and their footer, then the right column’s panels in their order — no tabs', () => {
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
    // objectstack#34590 — 动态 is the right column's LAST panel (supersedes
    // objectstack#27524 Targets 5 and 8's 动态-first for the column).
    expect(nodesIn(right)).toEqual(['record:related_list', 'record:related_list', 'record:activity']);
    // The stack's details are the whole width: the section's own container decides.
    expect(details.querySelector('[data-node="record:details"]')!.getAttribute('data-cap')).toBe('3');
  });
});

/**
 * objectstack#34590 (item 1) — on the default record page 动态 comes LAST:
 * the right column reads related → attachments → (approvals) → 动态, and the
 * stack reads details → related → attachments → (approvals) → 动态, so at a
 * phone's width the stream sits at the very bottom of the page. The
 * maintainer's words 「我们同事反馈动态不常用，是否建议移动到子表最后」「「动态」在最后」
 * supersede objectstack#27524 Targets 5 and 8's 动态-first for the column and
 * the stack. The tab row's order is not this card's and is not pinned here.
 */
describe('RecordPageColumns — 动态 last in the right column and the stack (objectstack#34590)', () => {
  const relatedLists = [
    { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
    { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
  ];
  const synth = (opts: { files: boolean; approvals: boolean }) =>
    buildDefaultPageColumns(
      buildDefaultPageSchema(
        {
          name: 'lead',
          label: 'Lead',
          fields: { name: { name: 'name', type: 'text' } },
          ...(opts.files ? { enable: { files: true } } : {}),
        },
        { related: relatedLists, ...(opts.approvals ? { approvals: { count: 1 } } : {}) },
      ),
    )!;
  /** The right column's blocks in document order, the panel's own node for 动态. */
  const expected = (opts: { files: boolean; approvals: boolean }) => [
    'record:related_list',
    'record:related_list',
    ...(opts.files ? ['record:attachments'] : []),
    ...(opts.approvals ? ['record:approvals'] : []),
    'record:activity',
  ];

  const cases = [
    { files: false, approvals: false },
    { files: true, approvals: false },
    { files: false, approvals: true },
    { files: true, approvals: true },
  ];
  for (const tier of ['wide', 'two-column', 'stack'] as const) {
    for (const opts of cases) {
      it(`${tier}, attachments ${opts.files ? 'on' : 'off'}, approvals ${opts.approvals ? 'on' : 'off'}: 动态 closes the column`, () => {
        const { container } = render(
          <RecordPageColumns tier={tier} columns={synth(opts)} footer={<p data-testid="meta-footer">meta</p>} />,
        );
        const right = column(container, 'right')!;
        expect(nodesIn(right)).toEqual(expected(opts));
        // The 动态 panel is the column's last element: nothing of the related
        // stack (its fold or foot lines) is drawn after it.
        expect(right.lastElementChild?.hasAttribute('data-record-timeline-panel')).toBe(true);
        expect(right.querySelectorAll('[data-record-timeline-panel]')).toHaveLength(1);
        if (tier === 'stack') {
          // One flow: the details (their footer closing them), then the panels,
          // so 动态 is the page's last block.
          const [details, panels] = Array.from(grid(container).children) as HTMLElement[];
          expect(details.getAttribute('data-record-column')).toBe('details');
          expect(panels).toBe(right);
          expect(grid(container).lastElementChild).toBe(right);
          expect(details.lastElementChild?.getAttribute('data-testid')).toBe('meta-footer');
        } else {
          expect(grid(container).getAttribute('data-record-columns-shown')).toBe('details right');
        }
      });
    }
  }

  it('a reader-rearranged related stack still ends before 动态: its foot line, then the 动态 panel', () => {
    const order = ['note.parent_id', 'task.lead_id'];
    const { container } = render(
      <RecordPageColumns
        tier="stack"
        columns={synth({ files: true, approvals: false })}
        relatedArrangement={{ order, hidden: [], basedOn: relatedDefaultOrderHash(['task.lead_id', 'note.parent_id']) }}
        onRelatedArrangementChange={() => {}}
      />,
    );
    const right = column(container, 'right')!;
    const lists = Array.from(right.querySelectorAll('[data-node="record:related_list"]')).map((n) => n.textContent);
    expect(lists).toEqual(['note', 'task']);
    expect(nodesIn(right)).toEqual(['record:related_list', 'record:related_list', 'record:attachments', 'record:activity']);
    const foot = right.querySelector('[data-related-foot-line]');
    expect(foot).not.toBeNull();
    const panel = right.lastElementChild!;
    expect(panel.hasAttribute('data-record-timeline-panel')).toBe(true);
    expect(foot!.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a page whose stream is off draws its related panels alone — no 动态 panel', () => {
    const bare = buildDefaultPageColumns(
      buildDefaultPageSchema({ name: 'lead', fields: {} }, { related: relatedLists, hideDiscussion: true }),
    )!;
    const { container } = render(<RecordPageColumns tier="wide" columns={bare} />);
    const right = column(container, 'right')!;
    expect(nodesIn(right)).toEqual(['record:related_list', 'record:related_list']);
    expect(right.querySelector('[data-record-timeline-panel]')).toBeNull();
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

  const quote = {
    name: 'quote',
    fields: {
      name: { type: 'text', label: 'Name' },
      terms: { type: 'textarea', label: 'Terms', group: 'terms' },
    },
  };
  const SECTIONS = [
    { label: 'Basic', fields: ['name'] },
    { label: 'Terms', fields: ['terms'] },
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
