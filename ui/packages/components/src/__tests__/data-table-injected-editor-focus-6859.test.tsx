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
 * so every keystroke is already staged while the editor is still open. The
 * `pointerdown` listener exits EDIT MODE; it does not rescue values. The table
 * is mounted select-first with a per-cell save, the one way it edits
 * (objectstack#35827).
 *
 * The same sequence was driven in a real Chromium against the real
 * `@object-ui/fields` widgets (text / date / number) before this file was
 * written; these are the jsdom pins for CI.
 *
 * ## The control
 *
 * Test A is the control and must stay green: a BUILT-IN editor DOES commit on
 * focus loss. Without it, test C's negative ("Tab commits nothing") would pass
 * just as well on a harness that cannot observe a commit at all. (Under the
 * select-first model Tab commits in every editor, so C is now a positive pin.)
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { openCellEditor, renderSelectFirstTable } from './test-utils';
// Module scope, not a hook — see object-ui/no-dynamic-import-in-test-hook.
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';

const baseSchema = {
  type: 'data-table' as const,
  editable: true,
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
    const { container } = renderSelectFirstTable({ ...baseSchema, onCellChange });

    const qtyCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
    openCellEditor(qtyCell);

    const input = qtyCell.querySelector('input:not([data-slot="cell-type-catcher"])') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.blur(input);

    expect(onCellChange).toHaveBeenCalledWith(0, 'qty', '42', expect.anything());
  });

  // B) pinned that a keystroke was staged into the "Save All" bar before any
  // exit event. The bar is retired with the staged model (objectstack#35827);
  // that the value staged while open is the one an exit commits is D below.

  it('C) Tab in an injected editor commits the typed value, as it does in a built-in one (objectstack#36023)', async () => {
    // The staged arm left an injected editor open on Tab; under the select-first
    // model, the one way the table edits (objectstack#35827), Tab is a commit
    // key in every editor, so nothing typed is left behind in an open editor.
    const onCellChange = vi.fn();
    const onRowSave = vi.fn(() => Promise.resolve());
    const outside = withOutsideTabStop();
    try {
      const { container } = renderSelectFirstTable({
        ...baseSchema,
        onCellChange,
        onRowSave,
        renderCellEditor: stagingEditor,
      });

      const qtyCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
      openCellEditor(qtyCell);
      const editor = qtyCell.querySelector('[data-testid="injected-editor"]') as HTMLInputElement;
      fireEvent.change(editor, { target: { value: 'TYPED' } });

      editor.focus();
      expect(document.activeElement).toBe(editor);
      await userEvent.tab();

      expect(onCellChange).toHaveBeenCalledWith(0, 'qty', 'TYPED', expect.anything());
      await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
      expect((onRowSave.mock.calls[0] as unknown[])[1]).toEqual({ qty: 'TYPED' });
      await waitFor(() => expect(qtyCell.querySelector('[data-testid="injected-editor"]')).toBeNull());
    } finally {
      outside.remove();
    }
  });

  it('D) a pointer press outside commits exactly what the injected editor staged', async () => {
    const onCellChange = vi.fn();
    const onRowSave = vi.fn(() => Promise.resolve());
    const outside = withOutsideTabStop();
    try {
      const { container } = renderSelectFirstTable({
        ...baseSchema,
        onCellChange,
        onRowSave,
        renderCellEditor: stagingEditor,
      });

      const qtyCell = container.querySelectorAll('tbody td')[1] as HTMLElement;
      openCellEditor(qtyCell);
      const editor = qtyCell.querySelector('[data-testid="injected-editor"]') as HTMLInputElement;
      fireEvent.change(editor, { target: { value: 'TYPED' } });

      fireEvent.pointerDown(outside);

      await waitFor(() =>
        expect(onCellChange).toHaveBeenCalledWith(0, 'qty', 'TYPED', expect.anything()),
      );
      await waitFor(() => expect(onRowSave).toHaveBeenCalledTimes(1));
      expect((onRowSave.mock.calls[0] as unknown[])[1]).toEqual({ qty: 'TYPED' });
      await waitFor(() =>
        expect(qtyCell.querySelector('[data-testid="injected-editor"]')).toBeNull(),
      );
    } finally {
      outside.remove();
    }
  });
});
