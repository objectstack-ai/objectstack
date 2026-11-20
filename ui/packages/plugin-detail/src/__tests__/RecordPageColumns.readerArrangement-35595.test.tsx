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
 * changed-default hint. The card stack's ⠿ handle, ⌥↑ / ⌥↓, 隐藏 and the
 * 「新」 badge were the related cards' chrome and leave the page with them
 * (`RelatedCardStack`, no longer drawn by the page). This file carries over
 * `RelatedCardStack-27055.test.tsx`; the merge rules themselves stay pinned in
 * `synth/__tests__/relatedArrangement-27055.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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

  it("draws the stored reader's order, and 「恢复默认顺序」 at the rail's foot restores the default", () => {
    const onWrite = vi.fn();
    const dragged = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const { container } = render(<Host initial={dragged} onWrite={onWrite} />);
    expect(listTabs()).toEqual(['call.lead_id', 'task.lead_id', 'note.parent_id']);
    const foot = container.querySelector('[data-record-column="right"] [data-related-foot-line]')!;
    expect(foot).not.toBeNull();
    const restore = foot.querySelector('[data-related-restore-default-order]') as HTMLButtonElement;
    expect(restore.textContent).toBe('Restore default order');
    fireEvent.click(restore);
    expect(listTabs()).toEqual(DEFAULT);
    expect(onWrite.mock.calls.at(-1)![0].order).toEqual([]);
    expect(container.querySelector('[data-related-foot-line]')).toBeNull();
  });

  it('a hidden list leaves the row for the end of 「更多 N ▾」; the foot line brings it back', () => {
    const hidden = editRelatedArrangement(DEFAULT, undefined, { kind: 'hide', id: 'task.lead_id' }, Date.now());
    const { container } = render(<Host initial={hidden} />);
    expect(listTabs()).toEqual(['note.parent_id', 'call.lead_id']);
    expect(document.querySelector('[data-record-tab-more]')?.textContent).toBe('More 1');
    const line = container.querySelector('[data-related-hidden-line]')!;
    expect(line).toBeTruthy();
    fireEvent.click(line.querySelector('button')!);
    expect(listTabs()).toEqual(DEFAULT);
    expect(container.querySelector('[data-related-hidden-line]')).toBeNull();
    expect(document.querySelector('[data-record-tab-more]')).toBeNull();
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

  it('CONTROL: the rail draws no card chrome — no ⠿ handle, no 隐藏, no related list drawn whole', () => {
    const dragged = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const { container } = render(<Host initial={dragged} />);
    const rail = container.querySelector('[data-record-column="right"]')!;
    expect(rail).not.toBeNull();
    expect(rail.querySelector('[data-related-card-id]')).toBeNull();
    expect(rail.querySelector('[data-node="record:related_list"]')).toBeNull();
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
