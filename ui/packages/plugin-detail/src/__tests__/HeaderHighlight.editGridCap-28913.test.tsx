/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28913 — on the default record page the highlight strip's grid
 * caps its EDIT face at three columns, so an inline editor (a lookup picker
 * above all, which draws the chosen name beside its own buttons) keeps a
 * usable width and six fields wrap to two rows of three. The read face keeps its
 * six columns, and the edit face still draws the empty fields, which must
 * stay fillable.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { HeaderHighlight } from '../HeaderHighlight';
import { DefaultRecordPageContext } from '../defaultRecordPage';

afterEach(cleanup);

const fields = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, label: name.toUpperCase() }));
// Two of the six are empty: the read face hides them, the edit face draws them.
const data = { a: 'one', b: 'two', c: 'three', d: 'four', e: '', f: null };
const objectSchema = { fields: Object.fromEntries(fields.map((f) => [f.name, { type: 'text' }])) };

function EditSession() {
  const inline = useInlineEdit();
  return (
    <>
      <button type="button" onClick={() => inline!.enter('a')}>enter-edit</button>
      <button type="button" onClick={() => inline!.cancel()}>cancel-edit</button>
    </>
  );
}

const renderStrip = () =>
  render(
    <DefaultRecordPageContext.Provider value>
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={fields} data={data} objectSchema={objectSchema} />
        <EditSession />
      </InlineEditProvider>
    </DefaultRecordPageContext.Provider>,
  );

const grid = () => document.querySelector('[data-highlights-face="grid"]') as HTMLElement;

/** Every column count the grid's classes can resolve to, at any container width. */
const columnCounts = (el: HTMLElement) =>
  [...el.className.matchAll(/(?:^|\s)(?:@[a-z0-9]+:)?grid-cols-(\d+)(?=\s|$)/g)].map((m) => Number(m[1]));

describe('HeaderHighlight — the edit face caps the grid at three columns (objectstack#28913)', () => {
  it('reads in up to six columns, drawing only the fields with a value', () => {
    renderStrip();
    expect(grid().className).toContain('@3xl:grid-cols-6');
    expect(Math.max(...columnCounts(grid()))).toBe(6);
    expect(grid().children).toHaveLength(4);
  });

  it('edits in at most three columns, drawing all six fields so they wrap to a second row', () => {
    renderStrip();
    fireEvent.click(screen.getByText('enter-edit'));
    const counts = columnCounts(grid());
    expect(Math.max(...counts)).toBe(3);
    expect(grid().className).not.toContain('grid-cols-6');
    // The narrower steps are the read face's, unchanged.
    expect(counts).toEqual(expect.arrayContaining([2, 3]));
    expect(grid().children).toHaveLength(6);
  });

  it('goes back to six columns when the edit is cancelled', () => {
    renderStrip();
    fireEvent.click(screen.getByText('enter-edit'));
    fireEvent.click(screen.getByText('cancel-edit'));
    expect(Math.max(...columnCounts(grid()))).toBe(6);
    expect(grid().children).toHaveLength(4);
  });
});
