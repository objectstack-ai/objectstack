/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36046 — the person cell draws a stored id as the person a pick
 * on this page handed back, and its initials are letters only.
 *
 * A pick stores the person's id; the record the picker handed back is kept
 * in the reference cache the lookup cell reads (`rememberPickedRecords`), so
 * the cell draws that person's name and face from it, not the raw id. An id
 * nothing on the page holds is still the unresolved reference objectui#8434
 * settled. The grid-level pin is `ObjectGrid.peoplePickName-36046.test.tsx`
 * in `@object-ui/plugin-grid`.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UserCellRenderer } from '../index';
import { rememberPickedRecords } from '../widgets/referenceRecordCache';

afterEach(cleanup);

const field = { name: 'owner', type: 'user' } as any;

describe('UserCellRenderer — a picked person is drawn by name, not id (objectstack#36046)', () => {
  it('a stored id whose person a pick handed back: the name and letters-only initials', () => {
    rememberPickedRecords('sys_user', [{ id: 'u36046_alice', name: 'Alice (Sales)' }]);
    const { container } = render(<UserCellRenderer value="u36046_alice" field={field} />);
    expect(container).toHaveTextContent('Alice (Sales)');
    expect(container).not.toHaveTextContent('u36046_alice');
    expect(container.querySelector('[data-slot="unresolved-reference"]')).toBeNull();
    expect(container).toHaveTextContent(/^AS/);
    expect(container).not.toHaveTextContent('A(');
  });

  it('several stored ids: each held person is a face, an unheld id stays unresolved', () => {
    rememberPickedRecords('sys_user', [
      { id: 'u36046_bob', name: '(Bob)' },
      { id: 'u36046_wang', name: '王小明' },
    ]);
    const { container } = render(
      <UserCellRenderer value={['u36046_bob', 'u36046_wang', 'u36046_nobody']} field={{ ...field, multiple: true }} />,
    );
    expect(container).toHaveTextContent('BO');
    expect(container).toHaveTextContent('小明');
    expect(container).not.toHaveTextContent('u36046_bob');
    expect(container.querySelectorAll('[data-slot="unresolved-reference"]')).toHaveLength(1);
    expect(container).toHaveTextContent('u36046_nobody');
  });

  it('control: an id no pick handed back is the unresolved reference, raw id kept', () => {
    const { container } = render(<UserCellRenderer value="u36046_unpicked" field={field} />);
    expect(container.querySelector('[data-slot="unresolved-reference"]')).not.toBeNull();
    expect(container).toHaveTextContent('u36046_unpicked');
  });

  it('an expanded person draws letters-only initials: "Alice (Sales)" gives AS', () => {
    const { container } = render(<UserCellRenderer value={{ id: 'u36046_x', name: 'Alice (Sales)' }} field={field} />);
    expect(container).toHaveTextContent(/^AS/);
  });
});
