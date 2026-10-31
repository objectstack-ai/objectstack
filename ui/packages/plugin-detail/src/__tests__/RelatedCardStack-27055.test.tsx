/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Targets 7 and 10 — the related column's panels in the
 * reader's arrangement, through `RecordPageColumns`. The related-list block
 * is stubbed (it draws its relationship id and the chrome it was handed), so
 * what is measured is the stack: the order the store says, the keyboard
 * moves the ⠿ handle hands each panel (objectstack#27524) written back
 * through the host's setter, the hidden line and the changed-default hint.
 * A panel no longer collapses (objectstack#27524, Target 1): its chrome
 * carries no collapse. The merge rules themselves are pinned in
 * `synth/__tests__/relatedArrangement-27055.test.ts`; the panel's own header
 * in `RelatedPanel.header-27524.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { RelatedCardChromeContext, RelatedListCompactContext } from '../relatedListCompact';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: ({ schema }: { schema: any }) => <StubNode schema={schema} />,
}));

function StubNode({ schema }: { schema: any }) {
  const chrome = React.useContext(RelatedCardChromeContext);
  const compact = React.useContext(RelatedListCompactContext);
  const p = schema?.properties ?? {};
  return (
    <section data-node={schema?.type} data-related-card-id={chrome?.id} data-compact={compact ? 'yes' : 'no'} data-limit={p.limit}>
      {chrome?.onEnlarge && <button onClick={chrome.onEnlarge}>{`enlarge ${p.objectName}`}</button>}
      {p.objectName ?? schema?.type}
      {chrome?.onMoveUp && <button onClick={chrome.onMoveUp}>{`up ${p.objectName}`}</button>}
      {chrome?.onMoveDown && <button onClick={chrome.onMoveDown}>{`down ${p.objectName}`}</button>}
      {chrome && <button onClick={chrome.onHide}>{`hide ${p.objectName}`}</button>}
      {chrome?.fresh && <span data-fresh="">new</span>}
    </section>
  );
}

import { RecordPageColumns } from '../RecordPageColumns';
import { buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
import { editRelatedArrangement, relatedDefaultOrderHash, type RelatedArrangement } from '../synth/relatedArrangement';

const RELATED = [
  { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks' },
  { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
  { objectName: 'call', relationshipField: 'lead_id', title: 'Calls' },
];
const DEFAULT = ['task.lead_id', 'note.parent_id', 'call.lead_id'];
const columnsOf = (related = RELATED) =>
  buildDefaultPageColumns(buildDefaultPageSchema({ name: 'lead', fields: {} }, { related, hideDiscussion: true }))!;

const cardOrder = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-record-column="right"] [data-related-card-id]')).map((el) =>
    el.getAttribute('data-related-card-id'),
  );

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

  it('the handle’s ⌥↑ / ⌥↓ write the new order through the host', () => {
    const onWrite = vi.fn();
    const { container } = render(<Host onWrite={onWrite} />);
    fireEvent.click(screen.getByText('down task'));
    expect(cardOrder(container)).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    expect(onWrite.mock.calls[0][0].order).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    // The first card offers no 上移, the last no 下移.
    expect(screen.queryByText('up note')).toBeNull();
    expect(screen.queryByText('down call')).toBeNull();
  });

  it('a panel carries no collapse: every shown panel mounts its list (objectstack#27524, Target 1)', () => {
    const { container } = render(<Host />);
    expect(container.querySelectorAll('[data-node="record:related_list"]')).toHaveLength(DEFAULT.length);
    expect(container.querySelector('[data-related-card-collapsed]')).toBeNull();
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

  it('「恢复默认顺序」 stands at the column foot once a card moved, and restores the default (objectstack#27241)', () => {
    const onWrite = vi.fn();
    const { container } = render(<Host onWrite={onWrite} />);
    // The default arrangement: no foot line at all.
    expect(container.querySelector('[data-related-foot-line]')).toBeNull();
    fireEvent.click(screen.getByText('down task'));
    expect(cardOrder(container)).toEqual(['note.parent_id', 'task.lead_id', 'call.lead_id']);
    const foot = container.querySelector('[data-record-column="right"] [data-related-foot-line]')!;
    expect(foot).not.toBeNull();
    // Not the changed-default hint: the author's default did not change.
    expect(container.querySelector('[data-related-default-changed]')).toBeNull();
    const restore = foot.querySelector('[data-related-restore-default-order]') as HTMLButtonElement;
    expect(restore.textContent).toBe('Restore default order');
    fireEvent.click(restore);
    expect(cardOrder(container)).toEqual(DEFAULT);
    const written = onWrite.mock.calls.at(-1)![0];
    expect(written.order).toEqual([]);
    expect(written.basedOn).toBe(relatedDefaultOrderHash(DEFAULT));
    expect(container.querySelector('[data-related-foot-line]')).toBeNull();
  });

  it('a hidden card puts 「恢复默认顺序」 on the hidden line, and it shows every card again (objectstack#27241)', () => {
    const { container } = render(<Host />);
    fireEvent.click(screen.getByText('hide note'));
    const foot = container.querySelector('[data-related-foot-line]')!;
    expect(foot.querySelector('[data-related-hidden-line]')).not.toBeNull();
    fireEvent.click(foot.querySelector('[data-related-restore-default-order]')!);
    expect(cardOrder(container)).toEqual(DEFAULT);
    expect(container.querySelector('[data-related-foot-line]')).toBeNull();
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
    // Rule 3: after its nearest default predecessor the reader's order holds (note).
    expect(cardOrder(container)).toEqual(['note.parent_id', 'call.lead_id', 'task.lead_id']);
    expect(container.querySelector('[data-related-card-id="call.lead_id"] [data-fresh]')).not.toBeNull();
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(Object.keys(onWrite.mock.calls[0][0].seen)).toEqual(['call.lead_id']);
    // Still badged after the stamp (48 h from it).
    expect(container.querySelector('[data-related-card-id="call.lead_id"] [data-fresh]')).not.toBeNull();
  });
});

describe('the enlarged related list — ⤢ and ?related= (objectstack#27055, Target 9)', () => {
  it('⤢ asks the host to enlarge that relationship', () => {
    const onEnlarge = vi.fn();
    render(<RecordPageColumns tier="wide" columns={columnsOf()} onEnlargeRelated={onEnlarge} />);
    fireEvent.click(screen.getByText('enlarge note'));
    expect(onEnlarge).toHaveBeenCalledWith('note.parent_id');
  });

  it('draws the full list over the page body: the header stays, the columns step aside', () => {
    const { container } = render(
      <RecordPageColumns tier="wide" columns={columnsOf()} enlargedRelated="note.parent_id" onCloseEnlargedRelated={vi.fn()} />,
    );
    const enlarged = container.querySelector('[data-related-enlarged="note.parent_id"]')!;
    expect(enlarged).toBeTruthy();
    expect(container.querySelector('[data-record-columns]')).toBeNull();
    // The FULL face, not the compact card — and paged.
    const list = enlarged.querySelector('[data-node="record:related_list"]')!;
    expect(list.getAttribute('data-compact')).toBe('no');
    expect(list.getAttribute('data-limit')).toBe('25');
    // The header nodes are still drawn above it.
    expect(container.querySelector('[data-node="page:header"]')).not.toBeNull();
  });

  it('‹ and Esc return to the columns', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RecordPageColumns tier="wide" columns={columnsOf()} enlargedRelated="note.parent_id" onCloseEnlargedRelated={onClose} />,
    );
    fireEvent.click(container.querySelector('[data-related-enlarged-back]')!);
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

import { ArrangedRelatedTab, RelatedArrangementScopeContext } from '../ArrangedRelatedTab';

describe('a page drawn as its strip: the 关联 tab reads the same arrangement (objectstack#27055, Target 7)', () => {
  const pageOf = () => buildDefaultPageSchema({ name: 'lead', fields: {}, enable: { files: true } }, { related: RELATED });
  const relatedTabOf = (page: any) =>
    page.regions[0].components.find((c: any) => c.type === 'page:tabs').properties.items.find((i: any) => i.value === 'related');

  it("orders the tab's lists by the reader, leaves the hidden out, keeps the attachments last", () => {
    let stored = editRelatedArrangement(DEFAULT, undefined, { kind: 'move', id: 'call.lead_id', to: 0 }, Date.now());
    stored = editRelatedArrangement(DEFAULT, stored, { kind: 'hide', id: 'note.parent_id' }, Date.now());
    let arranged: any = null;
    const onScope = vi.fn();
    const Probe = ({ report }: { report: (value: unknown) => void }) => {
      report(React.useContext(RelatedArrangementScopeContext));
      return null;
    };
    render(
      <ArrangedRelatedTab page={pageOf()} arrangement={stored} onArrangementChange={vi.fn()}>
        {(page) => {
          arranged = page;
          return <Probe report={onScope} />;
        }}
      </ArrangedRelatedTab>,
    );
    const scope: any = onScope.mock.calls.at(-1)?.[0];
    const children = relatedTabOf(arranged).children;
    expect(children.map((n: any) => n.properties?.objectName ?? n.type)).toEqual(['call', 'task', 'record:attachments']);
    expect(scope.lastId).toBe('task.lead_id');
    expect(scope.hiddenCount).toBe(1);
    expect(scope.chromeOf('call.lead_id').onMoveUp).toBeUndefined();
    expect(scope.chromeOf('note.parent_id')).toBeNull();
  });

  it('leaves a page with no 关联 tab as it was', () => {
    const page = buildDefaultPageSchema({ name: 'lead', fields: {} });
    let arranged: any = null;
    render(
      <ArrangedRelatedTab page={page}>
        {(next) => {
          arranged = next;
          return null;
        }}
      </ArrangedRelatedTab>,
    );
    expect(arranged).toBe(page);
  });
});
