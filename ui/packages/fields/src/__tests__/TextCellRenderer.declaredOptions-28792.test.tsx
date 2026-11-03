/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28792 — a `text` field that declares a non-empty `options` list
 * reads the matching option's LABEL in its read-only cell, as it already does
 * in an analytics dimension (`service-analytics` `dimension-labels.ts`) and a
 * grid group header (`plugin-grid` `objectGridGrouping.ts`).
 *
 * The spec allows `options` on every field type, and those two faces honour a
 * declared list on any type on purpose: "the condition is the declared list
 * itself, never the field's type". The text cell ignored it, so one
 * declaration read `backlog` in the cell and `Backlog` in the chart.
 *
 * The cell's test is the same as analytics' (`Array.isArray(options) &&
 * options.length > 0`). The stored value is untouched; a value that matches
 * no option reads as itself; a field with no list is unchanged. Edit inputs
 * stay free text inputs (out of scope by the card's route).
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TextCellRenderer, SelectCellRenderer, TextField, getCellRenderer } from '../index';

afterEach(() => cleanup());

const OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In progress' },
];

const textWithOptions = { type: 'text', name: 'stage', options: OPTIONS } as never;
const textWithoutOptions = { type: 'text', name: 'stage' } as never;

function cellMarkup(node: React.ReactElement): string {
  const { container } = render(node);
  const html = container.innerHTML;
  cleanup();
  return html;
}

describe('text cell reads a declared option label (objectstack#28792)', () => {
  it('a stored value that names a declared option reads its label', () => {
    const { container } = render(<TextCellRenderer value="backlog" field={textWithOptions} />);
    expect(container.textContent).toBe('Backlog');
    // The full-text hover fallback carries the same words the cell shows.
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('Backlog');
  });

  it('a value that matches no option reads as itself', () => {
    const { container } = render(<TextCellRenderer value="other" field={textWithOptions} />);
    expect(container.textContent).toBe('other');
  });

  it('an empty list is no list: the stored value reads as itself', () => {
    const { container } = render(
      <TextCellRenderer value="backlog" field={{ type: 'text', name: 'stage', options: [] } as never} />,
    );
    expect(container.textContent).toBe('backlog');
  });

  it('a field with no options is byte-identical to the text cell it always was', () => {
    expect(cellMarkup(<TextCellRenderer value="backlog" field={textWithoutOptions} />)).toBe(
      '<span class="block max-w-full truncate" title="backlog">backlog</span>',
    );
  });

  it('every type the text cell draws reads the declared list the same way (textarea)', () => {
    const Cell = getCellRenderer('textarea');
    const { container } = render(
      <Cell value="in_progress" field={{ type: 'textarea', name: 'stage', options: OPTIONS } as never} />,
    );
    expect(container.textContent).toBe('In progress');
  });

  it('control: a select field is unchanged', () => {
    const { container } = render(
      <SelectCellRenderer value="backlog" field={{ type: 'select', name: 'stage', options: OPTIONS } as never} />,
    );
    expect(container.textContent).toBe('Backlog');
  });

  it('control: the edit input of a text field with options holds the raw stored value', () => {
    const { container } = render(
      <TextField value="backlog" onChange={() => {}} field={textWithOptions} />,
    );
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('backlog');
  });
});
