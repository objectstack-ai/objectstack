/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545 — the list beside an open record marks the row the pane
 * shows. The open row follows every row click and `↑` / `↓` step, scrolls
 * into view, and a change re-renders the row it leaves and the row it
 * reaches — never the list around them (`record-list-face.tsx`).
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  ActiveListRecordProvider,
  ActiveListRow,
  listRecordIdOf,
  recordListFaceFor,
  RECORD_LIST_CARD_FACE_BELOW_PX,
} from '../custom/record-list-face';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope (objectui#3010).
import '../renderers';

afterEach(() => cleanup());

const IDS = ['a', 'b', 'c'];
/** Renders counted per component: the list, and each row by its id. */
const renders = { list: 0, rows: {} as Record<string, number> };

function Row({ id }: { id: string }) {
  return (
    <ActiveListRow<HTMLDivElement> recordId={id}>
      {(active, ref) => {
        renders.rows[id] = (renders.rows[id] ?? 0) + 1;
        return (
          <div ref={ref} data-testid={`row-${id}`} data-active={active ? '' : undefined}>
            {id}
          </div>
        );
      }}
    </ActiveListRow>
  );
}

const List = React.memo(function List() {
  renders.list += 1;
  return (
    <div>
      {IDS.map((id) => (
        <Row key={id} id={id} />
      ))}
    </div>
  );
});

const activeRows = () => IDS.filter((id) => screen.getByTestId(`row-${id}`).hasAttribute('data-active'));

describe('the open row', () => {
  it('follows the open record, re-rendering only the rows it leaves and reaches', () => {
    const scrolled: string[] = [];
    const spy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(function (this: HTMLElement) {
        scrolled.push(this.dataset.testid ?? '');
      });
    const list = <List />;
    const { rerender } = render(<ActiveListRecordProvider recordId="a">{list}</ActiveListRecordProvider>);
    expect(activeRows()).toEqual(['a']);
    expect(scrolled).toEqual(['row-a']);
    const before: Record<string, number> = { list: renders.list, ...renders.rows };

    rerender(<ActiveListRecordProvider recordId="b">{list}</ActiveListRecordProvider>);
    expect(activeRows()).toEqual(['b']);
    expect(scrolled).toEqual(['row-a', 'row-b']);
    expect(renders.list).toBe(before.list);
    expect(renders.rows.a).toBe(before.a + 1);
    expect(renders.rows.b).toBe(before.b + 1);
    expect(renders.rows.c).toBe(before.c);

    rerender(<ActiveListRecordProvider recordId={null}>{list}</ActiveListRecordProvider>);
    expect(activeRows()).toEqual([]);
    spy.mockRestore();
  });

  it('no provider: no row is the open one', () => {
    render(<List />);
    expect(activeRows()).toEqual([]);
  });

  it('a row is named by `id`, else `_id`, as text', () => {
    expect(listRecordIdOf({ id: 7 })).toBe('7');
    expect(listRecordIdOf({ _id: 'x' })).toBe('x');
    expect(listRecordIdOf({ id: '' })).toBeNull();
    expect(listRecordIdOf(null)).toBeNull();
  });

  it('the narrowed face turns to cards below 440 px', () => {
    expect(recordListFaceFor(RECORD_LIST_CARD_FACE_BELOW_PX)).toBe('columns');
    expect(recordListFaceFor(RECORD_LIST_CARD_FACE_BELOW_PX - 1)).toBe('cards');
  });
});

describe('the data table marks the open row', () => {
  it('tints and names the row of the open record, and moves with it', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    const schema = {
      type: 'data-table',
      columns: [{ header: 'Name', accessorKey: 'name' }],
      data: [
        { id: 'a', name: 'Ada' },
        { id: 'b', name: 'Bo' },
      ],
      pagination: false,
      searchable: false,
    } as never;
    const DataTable = ComponentRegistry.get('data-table')!;
    const table = <DataTable schema={schema} />;
    const { rerender } = render(<ActiveListRecordProvider recordId="b">{table}</ActiveListRecordProvider>);
    const rowOf = (name: string) => screen.getByText(name).closest('tr')!;
    expect(rowOf('Bo').hasAttribute('data-active-record')).toBe(true);
    expect(rowOf('Bo').getAttribute('aria-current')).toBe('true');
    expect(rowOf('Ada').hasAttribute('data-active-record')).toBe(false);
    rerender(<ActiveListRecordProvider recordId="a">{table}</ActiveListRecordProvider>);
    expect(rowOf('Ada').hasAttribute('data-active-record')).toBe(true);
    expect(rowOf('Bo').hasAttribute('data-active-record')).toBe(false);
  });
});
