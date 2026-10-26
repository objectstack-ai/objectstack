/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12664 — the injected-editor commit contract, at the seam itself.
 *
 * A host-injected cell editor may stage on every change, or only when its
 * control loses focus (the platform date picker reads its locale-formatted
 * text on blur). Before Enter or a pointer press outside commits, the table
 * blurs the control that holds focus inside the editor, and it commits the
 * LAST value staged — not the value from before a stage made earlier in the
 * same event. Escape discards without reading the control.
 *
 * `packages/components` does not depend on `@object-ui/fields`, so the
 * commit-on-blur widget is reproduced here with a plain input; the real
 * picker on the real `ObjectGrid` path is pinned in plugin-grid's
 * `inlineEditDatePicker-12664.test.tsx`.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { renderComponent } from './test-utils';
// Module scope, not a hook — see object-ui/no-dynamic-import-in-test-hook.
import '../renderers';

const baseSchema = {
  type: 'data-table' as const,
  editable: true,
  singleClickEdit: true,
  columns: [
    { header: 'Name', accessorKey: 'name', editable: false },
    { header: 'Due', accessorKey: 'due' },
  ],
  data: [{ id: '1', name: 'row-one', due: 'OLD' }],
} as any;

/** Keeps its text locally and stages it only when the control loses focus. */
function BlurCommitEditor({ value, stage }: { value: any; stage: (v: any) => void }) {
  const [text, setText] = React.useState(String(value ?? ''));
  return (
    <input
      data-testid="blur-commit-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => stage(text)}
    />
  );
}

const blurCommitEditor = ({ column, value, stage }: any) =>
  column.accessorKey === 'due' ? <BlurCommitEditor value={value} stage={stage} /> : null;

function openEditor(container: HTMLElement): HTMLInputElement {
  const dueCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
  fireEvent.click(dueCell);
  const editor = dueCell.querySelector('[data-testid="blur-commit-editor"]') as HTMLInputElement;
  expect(editor).toBeTruthy();
  editor.focus();
  fireEvent.change(editor, { target: { value: 'TYPED' } });
  return editor;
}

describe('data-table — a commit-on-blur injected editor (objectui#12664)', () => {
  it('Enter blurs the control first and commits what it staged', async () => {
    const onCellChange = vi.fn();
    const { container } = renderComponent({ ...baseSchema, onCellChange, renderCellEditor: blurCommitEditor });
    const editor = openEditor(container);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange).toHaveBeenCalledWith(0, 'due', 'TYPED', expect.anything());
    await waitFor(() => expect(container.querySelector('[data-testid="blur-commit-editor"]')).toBeNull());
  });

  it('a pointer press outside blurs the control first and commits what it staged', async () => {
    const onCellChange = vi.fn();
    const { container } = renderComponent({ ...baseSchema, onCellChange, renderCellEditor: blurCommitEditor });
    openEditor(container);
    fireEvent.pointerDown(document.body);
    expect(onCellChange).toHaveBeenCalledTimes(1);
    expect(onCellChange).toHaveBeenCalledWith(0, 'due', 'TYPED', expect.anything());
    await waitFor(() => expect(container.querySelector('[data-testid="blur-commit-editor"]')).toBeNull());
  });

  it('Escape discards: the control is not read and nothing is committed or staged', async () => {
    const onCellChange = vi.fn();
    const { container, queryByText } = renderComponent({ ...baseSchema, onCellChange, renderCellEditor: blurCommitEditor });
    const editor = openEditor(container);
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-testid="blur-commit-editor"]')).toBeNull());
    fireEvent.pointerDown(document.body);
    expect(onCellChange).not.toHaveBeenCalled();
    expect(queryByText(/Save All/i)).toBeNull();
  });
});
