/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * CHARACTERIZATION — what actually happens when focus leaves a HOST-INJECTED
 * cell editor (objectui#6859).
 *
 * ## Why this file exists
 *
 * `data-table.tsx` exits an injected editor through a document-level
 * `pointerdown` listener, and the comment at `injectedEditorElRef` used to
 * justify that with "the injected widgets (text, number, date, lookup, …) have
 * no such handler". That justification is stale — `onBlur` is a declared DOM
 * pass-through key every inline-edit widget forwards (objectui#6780, #6802) —
 * and correcting a comment leaves nothing behind that can rot loudly. A source
 * audit then read the same absence as a DATA-LOSS defect: no `focusout`, no
 * `onBlurCapture`, no `relatedTarget` anywhere in the file ⇒ Tab out of an
 * injected editor must silently drop the typed value.
 *
 * It does not, and this file is the measurement that says why. The value never
 * depends on the exit event: the host wires the widget's `onChange` to `stage`,
 * so every keystroke is already in `pendingChanges` while the editor is still
 * open. The `pointerdown` listener exits EDIT MODE; it does not rescue values.
 *
 * The same sequence was driven in a real Chromium against the real
 * `@object-ui/fields` widgets (text / date / number) before this file was
 * written; these are the jsdom pins for CI.
 *
 * ## The control
 *
 * Test A is the control and must stay green: a BUILT-IN editor DOES commit on
 * focus loss. Without it, test C's negative ("Tab commits nothing") would pass
 * just as well on a harness that cannot observe a commit at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    { header: 'Qty', accessorKey: 'qty', type: 'number' },
  ],
  data: [{ id: '1', name: 'row-one', qty: '' }],
} as any;

/**
 * The injected editor exactly as the in-repo host builds it
 * (`ObjectGrid.renderCellEditor`): a real control whose `onChange` is wired to
 * the context's `stage` — non-discrete field types stage, they do not commit.
 * `packages/components` does not depend on `@object-ui/fields`, so the wiring
 * is reproduced rather than imported; the browser run linked above is what
 * pins it to the real widgets.
 */
const stagingEditor = ({ column, value, stage }: any) =>
  column.accessorKey === 'qty' ? (
    <input
      data-testid="injected-editor"
      value={value ?? ''}
      onChange={(e) => stage(e.target.value)}
    />
  ) : null;

/** A tabbable element outside the table, so `userEvent.tab()` has somewhere to go. */
function withOutsideTabStop(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'outside-tab-stop';
  btn.textContent = 'outside';
  document.body.appendChild(btn);
  return btn;
}

describe('data-table — focus loss on a host-injected cell editor (objectui#6859)', () => {
  it('A) CONTROL: a BUILT-IN editor DOES commit when focus leaves it', async () => {
    // Proves the harness can observe a commit driven by focus loss at all, so
    // the negative results below are measurements and not dead probes.
    const onCellChange = vi.fn();
    const { container } = renderComponent({ ...baseSchema, onCellChange });

    const qtyCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
    fireEvent.click(qtyCell);

    const input = qtyCell.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);

    expect(onCellChange).toHaveBeenCalledWith(0, 'qty', '42', expect.anything());
  });

  it('B) an injected editor stages every keystroke — the value is pending BEFORE any exit event', () => {
    // This is the path the source audit could not see, and the reason Tab-out
    // is not lossy: `stage` writes straight into `pendingChanges` while the
    // editor is still open and still focused.
    const { container, getByText, queryByText } = renderComponent({
      ...baseSchema,
      renderCellEditor: stagingEditor,
    });

    const qtyCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
    // Nothing pending yet — the toolbar's save affordance is the readout.
    expect(queryByText(/Save All/i)).toBeNull();

    fireEvent.click(qtyCell);
    const editor = qtyCell.querySelector('[data-testid="injected-editor"]') as HTMLInputElement;
    expect(editor).toBeTruthy();
    fireEvent.change(editor, { target: { value: 'TYPED' } });

    // Still in edit mode, nothing committed — and the value is already staged.
    expect(qtyCell.querySelector('[data-testid="injected-editor"]')).toBeTruthy();
    expect(getByText(/Save All/i)).toBeInTheDocument();
  });

  it('C) tabbing out of an injected editor neither commits nor leaves edit mode', async () => {
    const onCellChange = vi.fn();
    const outside = withOutsideTabStop();
    try {
      const { container } = renderComponent({
        ...baseSchema,
        onCellChange,
        renderCellEditor: stagingEditor,
      });

      const qtyCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
      fireEvent.click(qtyCell);
      const editor = qtyCell.querySelector('[data-testid="injected-editor"]') as HTMLInputElement;
      fireEvent.change(editor, { target: { value: 'TYPED' } });

      editor.focus();
      expect(document.activeElement).toBe(editor);
      await userEvent.tab();

      // Focus really left the editor …
      expect(document.activeElement).not.toBe(editor);
      // … and nothing committed: no exit, no onCellChange. This is the fact the
      // corrected comment at `injectedEditorElRef` now states, and the reason
      // the document-level pointerdown listener is still load-bearing.
      expect(onCellChange).not.toHaveBeenCalled();
      expect(qtyCell.querySelector('[data-testid="injected-editor"]')).toBeTruthy();
    } finally {
      outside.remove();
    }
  });

  it('D) …and the typed value is still there — the outside pointer press commits exactly it', async () => {
    const onCellChange = vi.fn();
    const outside = withOutsideTabStop();
    try {
      const { container } = renderComponent({
        ...baseSchema,
        onCellChange,
        renderCellEditor: stagingEditor,
      });

      const qtyCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
      fireEvent.click(qtyCell);
      const editor = qtyCell.querySelector('[data-testid="injected-editor"]') as HTMLInputElement;
      fireEvent.change(editor, { target: { value: 'TYPED' } });

      editor.focus();
      await userEvent.tab();
      // A pointer press truly outside is what exits the editor today.
      fireEvent.pointerDown(outside);

      await waitFor(() =>
        expect(onCellChange).toHaveBeenCalledWith(0, 'qty', 'TYPED', expect.anything()),
      );
      // Edit mode is over and the cell reads back what was typed — nothing lost
      // across the Tab-out.
      await waitFor(() =>
        expect(qtyCell.querySelector('[data-testid="injected-editor"]')).toBeNull(),
      );
      expect(qtyCell.textContent).toContain('TYPED');
    } finally {
      outside.remove();
    }
  });
});
