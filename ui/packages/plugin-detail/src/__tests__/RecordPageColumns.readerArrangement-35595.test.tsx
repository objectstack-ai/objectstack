/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35595 — the reader's arrangement of the related lists
 * (objectstack#27055, Targets 7 and 10; objectstack#27241) through
 * `RecordPageColumns`, now that every related list is a TAB and the right
 * column is the 概览 tab's summary rail (objectstack#35596). The stored order
 * orders the tab row; a hidden list's tab waits at the end of 「更多 N ▾」;
 * the rail's foot keeps 「已隐藏 N 个 · 显示」, 「恢复默认顺序」 and the
 * changed-default hint. The card stack's ⠿ handle, ⌥↑ / ⌥↓ and the 「新」
 * badge left the page with the related cards; moving and hiding came back on
 * the tabs (objectstack#35783): an open list's tab is its menu — 「左移」,
 * 「右移」, 「隐藏」 — and 「更多」 ends with 「恢复默认顺序」 while the
 * arrangement is not the default, in a drawer too. This file carries over
 * `RelatedCardStack-27055.test.tsx`; the merge rules themselves stay pinned in
 * `synth/__tests__/relatedArrangement-27055.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelatedListCompactContext, RelatedListEnlargedContext } from '../relatedListCompact';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => <StubNode schema={schema} />,
}));

function StubNode({ schema }: { schema: any }) {
  const compact = React.useContext(RelatedListCompactContext);
  const enlarged = React.useContext(RelatedListEnlargedContext);
  const p = schema?.properties ?? {};
  return (
    <section data-node={schema?.type} data-compact={compact ? 'yes' : 'no'} data-enlarged={enlarged ? 'yes' : 'no'} data-limit={p.limit}>
      {p.objectName ?? schema?.type}
    </section>
  );
}

import { RecordPageColumns } from '../RecordPageColumns';
import { buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
import { editRelatedArrangement, type RelatedArrangement } from '../synth/relatedArrangement';

const RELATED = [
  { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
  { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
  { objectName: 'call', relationshipField: 'lead_id', title: 'Calls' },
];
const DEFAULT = ['task.lead_id', 'note.parent_id', 'call.lead_id'];
const columnsOf = (related = RELATED) =>
  buildDefaultPageColumns(buildDefaultPageSchema({ name: 'lead', fields: {} }, { related, hideDiscussion: true }))!;

/** The related lists' tabs on the row, in order. */
const listTabs = () =>
  Array.from(document.querySelectorAll('[role="tab"][data-record-tab]'))
    .map((el) => el.getAttribute('data-record-tab'))
    .filter((id) => id !== 'overview');

/** A host with a real store: the arrangement round-trips through state. */
function Host({ initial, onWrite, related }: { initial?: RelatedArrangement; onWrite?: (v: RelatedArrangement) => void; related?: typeof RELATED }) {
  const [arrangement, setArrangement] = React.useState<RelatedArrangement | undefined>(initial);
  return (
    <RecordPageColumns
      tier="wide"
      columns={columnsOf(related)}
      relatedArrangement={arrangement}
      onRelatedArrangementChange={(next) => {
        onWrite?.(next);
        setArrangement(next);
      }}
      onEnlargeRelated={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe('the reader\'s arrangement orders the tab row (objectstack#35595, carrying objectstack#27055 / objectstack#27241)', () => {
  it('draws the default order for a reader who never chose, with no foot line', () => {
    const { container } = render(<Host />);
    expect(listTabs()).toEqual(DEFAULT);
    expect(container.querySelector('[data-related-foot-line]')).toBeNull();
  });

  it("draws the stored reader's order; with the rail gone (objectstack#35890) no foot line — 「更多」 holds the reset", () => {
    const dragged = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const { container } = render(<Host initial={dragged} />);
    expect(listTabs()).toEqual(['call.lead_id', 'task.lead_id', 'note.parent_id']);
    expect(container.querySelector('[data-related-foot-line]')).toBeNull();
    expect(document.querySelector('[data-record-tab-more]')).not.toBeNull();
  });

  it('a hidden list leaves the row for the end of 「更多 N ▾」', () => {
    const hidden = editRelatedArrangement(DEFAULT, undefined, { kind: 'hide', id: 'task.lead_id' }, Date.now());
    const { container } = render(<Host initial={hidden} />);
    expect(listTabs()).toEqual(['note.parent_id', 'call.lead_id']);
    expect(document.querySelector('[data-record-tab-more]')?.textContent).toBe('More 1');
    expect(container.querySelector('[data-related-hidden-line]')).toBeNull();
  });

  it('says when the default changed under a dragged order, and restores it', () => {
    const dragged = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const reordered = [RELATED[1], RELATED[0], RELATED[2]];
    const { container } = render(<Host initial={dragged} related={reordered} />);
    expect(listTabs()).toEqual(['call.lead_id', 'task.lead_id', 'note.parent_id']);
    const hint = container.querySelector('[data-related-default-changed]')!;
    expect(hint).toBeTruthy();
    fireEvent.click(hint.querySelector('button')!);
    expect(listTabs()).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    expect(container.querySelector('[data-related-default-changed]')).toBeNull();
  });

  it('CONTROL: no rail is drawn, so no list is drawn whole beside the details (objectstack#35890)', () => {
    const dragged = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const { container } = render(<Host initial={dragged} />);
    expect(container.querySelector('[data-record-column="right"]')).toBeNull();
    expect(container.querySelector('[data-related-card-id]')).toBeNull();
    expect(container.querySelector('[data-node="record:related_list"]')).toBeNull();
  });
});

describe('a related list\'s tab — ?related= (objectstack#27055, Target 9; objectstack#35595)', () => {
  it('a list\'s tab asks the host to open that relationship', () => {
    const onEnlarge = vi.fn();
    render(<RecordPageColumns tier="wide" columns={columnsOf()} onEnlargeRelated={onEnlarge} />);
    fireEvent.click(document.querySelector('[data-record-tab="note.parent_id"]')!);
    expect(onEnlarge).toHaveBeenCalledWith('note.parent_id');
  });

  it('draws the full list over the page body: the header stays, the columns step aside', () => {
    const { container } = render(
      <RecordPageColumns tier="wide" columns={columnsOf()} enlargedRelated="note.parent_id" onCloseEnlargedRelated={vi.fn()} />,
    );
    const enlarged = container.querySelector('[data-related-enlarged="note.parent_id"]')!;
    expect(enlarged).toBeTruthy();
    expect(container.querySelector('[data-record-columns]')).toBeNull();
    // The FULL face, not a compact card — and paged.
    const list = enlarged.querySelector('[data-node="record:related_list"]')!;
    expect(list.getAttribute('data-compact')).toBe('no');
    expect(list.getAttribute('data-enlarged')).toBe('yes');
    expect(list.getAttribute('data-limit')).toBe('25');
    expect(container.querySelector('[data-node="page:header"]')).not.toBeNull();
  });

  it('「概览」 and Esc return to the columns (objectstack#27524, Target 9)', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        enlargedRelated="note.parent_id"
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={onClose}
      />,
    );
    fireEvent.click(container.querySelector('[data-record-tab="overview"]')!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('an id naming no related list draws the columns', () => {
    const { container } = render(
      <RecordPageColumns tier="wide" columns={columnsOf()} enlargedRelated="ghost.parent_id" />,
    );
    expect(container.querySelector('[data-related-enlarged]')).toBeNull();
    expect(container.querySelector('[data-record-columns]')).not.toBeNull();
  });
});

describe('a related tab\'s menu and 「更多」\'s reset (objectstack#35783)', () => {
  /** A host holding the store and the open tab, as the record page does. */
  function TabHost({ initial, onWrite, rail, columns = columnsOf() }: {
    initial?: RelatedArrangement;
    onWrite?: (v: RelatedArrangement) => void;
    rail?: boolean;
    columns?: ReturnType<typeof columnsOf>;
  }) {
    const [arrangement, setArrangement] = React.useState<RelatedArrangement | undefined>(initial);
    const [open, setOpen] = React.useState<string | undefined>(undefined);
    return (
      <RecordPageColumns
        tier="wide"
        columns={columns}
        rail={rail}
        relatedArrangement={arrangement}
        onRelatedArrangementChange={(next) => {
          onWrite?.(next);
          setArrangement(next);
        }}
        enlargedRelated={open}
        onEnlargeRelated={setOpen}
        onCloseEnlargedRelated={() => setOpen(undefined)}
      />
    );
  }
  const tabEl = (id: string) => document.querySelector(`[role="tab"][data-record-tab="${id}"]`) as HTMLElement;
  /** Open `id`'s tab, then its menu, and choose `edit`. */
  async function arrange(user: ReturnType<typeof userEvent.setup>, id: string, edit: string) {
    if (tabEl(id).getAttribute('aria-selected') !== 'true') await user.click(tabEl(id));
    await user.click(tabEl(id));
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(edit) }));
  }

  it('「左移」 and 「右移」 move the open list one place and keep it; at either end the way out is disabled', async () => {
    const user = userEvent.setup();
    const onWrite = vi.fn();
    render(<TabHost onWrite={onWrite} />);
    await arrange(user, 'note.parent_id', 'Move left');
    expect(listTabs()).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    expect(onWrite.mock.calls.at(-1)![0].order).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    await arrange(user, 'task.lead_id', 'Move right');
    expect(listTabs()).toEqual(['note.parent_id', 'call.lead_id', 'task.lead_id']);
    // The last list cannot go further right; CONTROL, it can go left.
    await user.click(tabEl('task.lead_id'));
    expect((await screen.findByRole('menuitem', { name: /Move right/ })).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /Move left/ }).hasAttribute('aria-disabled')).toBe(false);
  });

  it('「隐藏」 takes the open list off the row into 「更多」\'s hidden lists and returns to 概览', async () => {
    const user = userEvent.setup();
    const onWrite = vi.fn();
    const { container } = render(<TabHost onWrite={onWrite} />);
    await arrange(user, 'note.parent_id', 'Hide');
    expect(listTabs()).toEqual(['task.lead_id', 'call.lead_id']);
    expect(onWrite.mock.calls.at(-1)![0].hidden).toEqual(['note.parent_id']);
    expect(tabEl('overview').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-related-enlarged]')).toBeNull();
    await user.click(document.querySelector('[data-record-tab-more]') as HTMLElement);
    const hiddenItem = (await screen.findAllByRole('menuitem')).find((el) => el.hasAttribute('data-record-tab-hidden'));
    expect(hiddenItem?.getAttribute('data-record-tab-menu-item')).toBe('note.parent_id');
  });

  it('a hidden list still opens: from its item in 「更多」, and from an address that names it (objectstack#35890)', async () => {
    const user = userEvent.setup();
    const hidden = editRelatedArrangement(DEFAULT, undefined, { kind: 'hide', id: 'note.parent_id' }, Date.now());
    const { container, unmount } = render(<TabHost initial={hidden} />);
    expect(listTabs()).toEqual(['task.lead_id', 'call.lead_id']);
    await user.click(document.querySelector('[data-record-tab-more]') as HTMLElement);
    await user.click(
      document.querySelector('[data-record-tab-hidden][data-record-tab-menu-item="note.parent_id"]') as HTMLElement,
    );
    expect(container.querySelector('[data-related-enlarged="note.parent_id"]')).not.toBeNull();
    unmount();
    // The address names the hidden list (?related=note.parent_id): its face opens.
    const page = render(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        relatedArrangement={hidden}
        onRelatedArrangementChange={vi.fn()}
        enlargedRelated="note.parent_id"
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={vi.fn()}
      />,
    );
    expect(page.container.querySelector('[data-related-enlarged="note.parent_id"]')).not.toBeNull();
    // CONTROL: an id naming no list still draws the columns.
    page.rerender(
      <RecordPageColumns
        tier="wide"
        columns={columnsOf()}
        relatedArrangement={hidden}
        onRelatedArrangementChange={vi.fn()}
        enlargedRelated="nope.nope"
        onEnlargeRelated={vi.fn()}
        onCloseEnlargedRelated={vi.fn()}
      />,
    );
    expect(page.container.querySelector('[data-related-enlarged]')).toBeNull();
  });

  it('「更多」 ends with 「恢复默认顺序」 while the arrangement is not the default: the default order, every list shown — in a drawer too', async () => {
    const user = userEvent.setup();
    const onWrite = vi.fn();
    const moved = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const both = editRelatedArrangement(DEFAULT, moved, { kind: 'hide', id: 'task.lead_id' }, Date.now());
    const { container } = render(<TabHost initial={both} onWrite={onWrite} rail={false} />);
    // A drawer: no rail, so no foot line — 「更多」 is the one way back.
    expect(container.querySelector('[data-related-foot-line]')).toBeNull();
    expect(listTabs()).toEqual(['call.lead_id', 'note.parent_id']);
    await user.click(document.querySelector('[data-record-tab-more]') as HTMLElement);
    await user.click(await screen.findByRole('menuitem', { name: 'Restore default order' }));
    expect(listTabs()).toEqual(DEFAULT);
    expect(onWrite.mock.calls.at(-1)![0]).toMatchObject({ order: [], hidden: [] });
    // CONTROL: in the default arrangement there is nothing to restore, and a row that fits draws no 「更多」.
    expect(document.querySelector('[data-record-tab-more]')).toBeNull();
  });

  it('a row moved but nothing hidden still offers the reset, under a bare 「更多」', async () => {
    const user = userEvent.setup();
    const moved = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    render(<TabHost initial={moved} />);
    const trigger = document.querySelector('[data-record-tab-more]') as HTMLElement;
    expect(trigger.textContent).toBe('More');
    await user.click(trigger);
    expect((await screen.findAllByRole('menuitem')).map((el) => el.textContent)).toEqual(['Restore default order']);
  });

  it('概览, 附件, 审批 and 动态 are fixed: open, they have no menu; CONTROL, an open list\'s tab has one', async () => {
    const user = userEvent.setup();
    const columns = buildDefaultPageColumns(
      buildDefaultPageSchema({ name: 'lead', fields: {}, enable: { files: true } } as any, {
        related: RELATED,
        hideDiscussion: false,
        approvals: { count: 1, node: { approvals: { available: true, requests: [{ id: 'r1' }] } } },
      }),
    )!;
    render(<TabHost columns={columns} />);
    const fixed = ['overview', 'attachments', 'approvals', 'timeline'];
    for (const id of fixed) {
      expect(tabEl(id), id).not.toBeNull();
      if (tabEl(id).getAttribute('aria-selected') !== 'true') await user.click(tabEl(id));
      expect(tabEl(id).getAttribute('aria-selected')).toBe('true');
      await user.click(tabEl(id));
      expect(tabEl(id).hasAttribute('aria-haspopup'), id).toBe(false);
      expect(document.querySelector('[data-record-tab-arrange-menu]'), id).toBeNull();
    }
    await user.click(tabEl('call.lead_id'));
    await user.click(tabEl('call.lead_id'));
    expect(tabEl('call.lead_id').getAttribute('aria-haspopup')).toBe('menu');
    expect(document.querySelector('[data-record-tab-arrange-menu="call.lead_id"]')).not.toBeNull();
  });

  it('a list\'s tab not yet open opens on its first click and on Enter, with no menu', async () => {
    const user = userEvent.setup();
    render(<TabHost />);
    await user.click(tabEl('note.parent_id'));
    expect(tabEl('note.parent_id').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-record-tab-arrange-menu]')).toBeNull();
    tabEl('call.lead_id').focus();
    await user.keyboard('{Enter}');
    expect(tabEl('call.lead_id').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-record-tab-arrange-menu]')).toBeNull();
  });
});
