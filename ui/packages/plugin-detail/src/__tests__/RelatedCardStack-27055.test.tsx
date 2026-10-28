/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Targets 7 and 10 — the related column's cards in the
 * reader's arrangement, through `RecordPageColumns`. The related-list block
 * is stubbed (it draws its relationship id and the chrome it was handed), so
 * what is measured is the stack: the order the store says, a collapsed card
 * drawn without the list (no rows read), the keyboard moves of the `⋯` menu
 * written back through the host's setter, the hidden line and the
 * changed-default hint. The merge rules themselves are pinned in
 * `synth/__tests__/relatedArrangement-27055.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { RelatedCardChromeContext } from '../relatedListCompact';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => <StubNode schema={schema} />,
}));

function StubNode({ schema }: { schema: any }) {
  const chrome = React.useContext(RelatedCardChromeContext);
  const p = schema?.properties ?? {};
  return (
    <section data-node={schema?.type} data-related-card-id={chrome?.id}>
      {p.objectName ?? schema?.type}
      {chrome?.onMoveUp && <button onClick={chrome.onMoveUp}>{`up ${p.objectName}`}</button>}
      {chrome?.onMoveDown && <button onClick={chrome.onMoveDown}>{`down ${p.objectName}`}</button>}
      {chrome && <button onClick={chrome.onCollapse}>{`collapse ${p.objectName}`}</button>}
      {chrome && <button onClick={chrome.onHide}>{`hide ${p.objectName}`}</button>}
      {chrome?.fresh && <span data-fresh="">new</span>}
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

const cardOrder = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-record-column="related"] [data-related-card-id]')).map((el) =>
    el.getAttribute('data-related-card-id'),
  );

/** A host with a real store: the arrangement round-trips through state. */
function Host({ initial, onWrite, related }: { initial?: RelatedArrangement; onWrite?: (v: RelatedArrangement) => void; related?: typeof RELATED }) {
  const [arrangement, setArrangement] = React.useState<RelatedArrangement | undefined>(initial);
  return (
    <RecordPageColumns
      tier="three-column"
      columns={columnsOf(related)}
      relatedArrangement={arrangement}
      onRelatedArrangementChange={(next) => {
        onWrite?.(next);
        setArrangement(next);
      }}
    />
  );
}

afterEach(cleanup);

describe('RelatedCardStack — the reader arranges the related cards (objectstack#27055)', () => {
  it('draws the default order for a reader who never chose', () => {
    const { container } = render(<Host />);
    expect(cardOrder(container)).toEqual(DEFAULT);
  });

  it("draws the stored reader's order", () => {
    const dragged = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const { container } = render(<Host initial={dragged} />);
    expect(cardOrder(container)).toEqual(['call.lead_id', 'task.lead_id', 'note.parent_id']);
  });

  it('上移 / 下移 write the new order through the host', () => {
    const onWrite = vi.fn();
    const { container } = render(<Host onWrite={onWrite} />);
    fireEvent.click(screen.getByText('down task'));
    expect(cardOrder(container)).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    expect(onWrite.mock.calls[0][0].order).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    // The first card offers no 上移, the last no 下移.
    expect(screen.queryByText('up note')).toBeNull();
    expect(screen.queryByText('down call')).toBeNull();
  });

  it('a collapsed card is drawn without the list — it reads no rows', () => {
    const { container } = render(<Host />);
    fireEvent.click(screen.getByText('collapse note'));
    const collapsed = container.querySelector('[data-related-card-collapsed]');
    expect(collapsed?.getAttribute('data-related-card-id')).toBe('note.parent_id');
    // The list block for `note` is not mounted at all.
    expect(container.querySelector('[data-node="record:related_list"][data-related-card-id="note.parent_id"]')).toBeNull();
    // Expanding mounts it again.
    fireEvent.click(collapsed!.querySelector('button[aria-expanded="false"]')!);
    expect(container.querySelector('[data-node="record:related_list"][data-related-card-id="note.parent_id"]')).not.toBeNull();
  });

  it('a hidden card leaves the column; the last line brings them back', () => {
    const { container } = render(<Host />);
    fireEvent.click(screen.getByText('hide task'));
    expect(cardOrder(container)).toEqual(['note.parent_id', 'call.lead_id']);
    const line = container.querySelector('[data-related-hidden-line]')!;
    expect(line).toBeTruthy();
    fireEvent.click(line.querySelector('button')!);
    expect(cardOrder(container)).toEqual(DEFAULT);
    expect(container.querySelector('[data-related-hidden-line]')).toBeNull();
  });

  it('says when the default changed under a dragged order, and restores it', () => {
    const dragged = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    const reordered = [RELATED[1], RELATED[0], RELATED[2]];
    const { container } = render(<Host initial={dragged} related={reordered} />);
    expect(cardOrder(container)).toEqual(['call.lead_id', 'task.lead_id', 'note.parent_id']);
    const hint = container.querySelector('[data-related-default-changed]')!;
    expect(hint).toBeTruthy();
    fireEvent.click(hint.querySelector('button')!);
    expect(cardOrder(container)).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    expect(container.querySelector('[data-related-default-changed]')).toBeNull();
  });

  it('badges a relationship new since the drag, and stamps it as seen once', async () => {
    const dragged = editRelatedArrangement(DEFAULT.slice(0, 2), undefined, { kind: 'move', id: 'note.parent_id', to: 0 }, Date.now());
    const onWrite = vi.fn();
    const { container } = render(<Host initial={dragged} onWrite={onWrite} />);
    expect(cardOrder(container)).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    expect(container.querySelector('[data-related-card-id="call.lead_id"] [data-fresh]')).not.toBeNull();
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(Object.keys(onWrite.mock.calls[0][0].seen)).toEqual(['call.lead_id']);
    // Still badged after the stamp (48 h from it).
    expect(container.querySelector('[data-related-card-id="call.lead_id"] [data-fresh]')).not.toBeNull();
  });
});
