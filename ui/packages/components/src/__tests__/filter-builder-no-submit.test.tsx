/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * FilterBuilder is embedded inside forms — notably the sharing-rule dialog's
 * `criteria_json` field. None of its controls declared `type="button"`, and a
 * bare <button> inside a <form> defaults to `type="submit"`, so building a
 * filter submitted the surrounding dialog: validation fired mid-edit, and on an
 * already-valid form the record saved before the admin was done
 * (objectstack#3821).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FilterBuilder } from '../custom/filter-builder';

const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'pinned', label: 'Pinned', type: 'boolean' },
];

// `React.FormEventHandler`, not `() => void`: every caller passes a spy that
// takes the event and calls `preventDefault()` on it, and a one-parameter
// function is not assignable to a zero-parameter one — the helper's declared
// type contradicted all three of its uses (objectui#4040).
function renderInForm(
  onSubmit: React.FormEventHandler<HTMLFormElement>,
  value?: any,
) {
  return render(
    <form onSubmit={onSubmit}>
      <FilterBuilder
        fields={FIELDS as any}
        value={value}
        onChange={vi.fn()}
        showClearAll
      />
      <button type="submit">save</button>
    </form>,
  );
}

const CONDITION = {
  id: 'c1',
  logic: 'and',
  conditions: [{ id: 'c1a', field: 'title', operator: 'equals', value: 'x' }],
};

describe('FilterBuilder never submits its surrounding form', () => {
  it('adding a condition does not submit', () => {
    const onSubmit = vi.fn((e: any) => e.preventDefault());
    renderInForm(onSubmit);
    fireEvent.click(screen.getByRole('button', { name: /add filter|添加筛选/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('removing a condition does not submit', () => {
    const onSubmit = vi.fn((e: any) => e.preventDefault());
    renderInForm(onSubmit, CONDITION);
    fireEvent.click(screen.getByRole('button', { name: /remove condition|移除条件|删除条件/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clear-all does not submit', () => {
    const onSubmit = vi.fn((e: any) => e.preventDefault());
    renderInForm(onSubmit, CONDITION);
    fireEvent.click(screen.getByRole('button', { name: /clear all|清除全部/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('every FilterBuilder control declares an explicit button type', () => {
    const { container } = renderInForm(vi.fn(), CONDITION);
    const implicitSubmit = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.getAttribute('type') && b.textContent !== 'save',
    );
    expect(implicitSubmit.map((b) => b.textContent)).toEqual([]);
  });
});
