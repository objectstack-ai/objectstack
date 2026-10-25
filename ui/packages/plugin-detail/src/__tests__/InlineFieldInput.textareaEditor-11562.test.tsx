/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11562 — `record:details` edit mode edits a `textarea` field in a
 * MULTI-line editor, so a save writes back the text that was stored, line
 * breaks included.
 *
 * Before, `textarea` was a member of `INLINE_PLAIN_TEXT_FIELD_TYPES` (class D,
 * objectui#4220: "the stored value is already a string, nothing is lost"), so
 * the row edited in this component's terminal input, an `<input type="text">`.
 * That holds for a single-line value only. The browser strips every line break
 * from the value a text input is seeded with, so a stored note with blank lines
 * and a trailing newline was shown flattened, and one keystroke made the
 * flattened string the value the Save batch wrote. Nothing warned.
 *
 * The row now routes `textarea` to the fields package's `TextAreaField`, the
 * widget `markdown` got in objectui#11541 and the one a `textarea` field
 * already edits with in the record form and in a grid cell. The pins below
 * compare values BYTE for byte with blank lines and a trailing newline in them:
 * a single-line editor cannot pass them. A single-line value is pinned beside
 * them, so the move is shown to change nothing for it.
 *
 * The hosts' gate needed no change: `textarea` is not in the fields package's
 * shared `INLINE_EXCLUDED_FIELD_TYPES`, so both detail hosts already opened an
 * editor for it. It was the editor that was wrong.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { FieldEditWidget } from '@object-ui/fields';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import { InlineEditSaveBar } from '../InlineEditSaveBar';
import { InlineFieldInput, INLINE_PLAIN_TEXT_INPUT_TESTID } from '../InlineFieldInput';

/** A blank line inside and a trailing newline: the bytes a one-line box drops. */
const MULTI_LINE = 'Call back Monday.\n\nBudget approved, needs legal review.\n';
/** The control: a value a one-line box already kept intact. */
const SINGLE_LINE = 'Call back Monday.';

const plainInput = (root: ParentNode = document) =>
  root.querySelector(`[data-testid="${INLINE_PLAIN_TEXT_INPUT_TESTID}"]`);
const editors = (root: ParentNode) => root.querySelectorAll('input, textarea');
const textareaIn = (root: ParentNode) => root.querySelector('textarea') as HTMLTextAreaElement | null;
const hasPencil = () => screen.queryAllByLabelText('Double-click to edit').length > 0;

beforeAll(() => {
  // Desktop layout — the mobile branch renders its own read-only row shape.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// ---------------------------------------------------------------------------
// The editor itself
// ---------------------------------------------------------------------------

describe('objectui#11562 — InlineFieldInput edits textarea in a multi-line textarea', () => {
  for (const [label, stored] of [['multi-line', MULTI_LINE], ['single-line', SINGLE_LINE]] as const) {
    it(`a ${label} value seeds a textarea byte for byte, never the terminal input`, () => {
      const { container } = render(
        <InlineFieldInput field={{ name: 'notes', type: 'textarea' }} value={stored} onChange={vi.fn()} />,
      );
      expect(plainInput(container)).toBeNull();
      expect(textareaIn(container)).not.toBeNull();
      expect(textareaIn(container)!.value).toBe(stored);
    });

    it(`one keystroke on a ${label} value emits the stored text plus that keystroke, exactly`, () => {
      const onChange = vi.fn();
      const { container } = render(
        <InlineFieldInput field={{ name: 'notes', type: 'textarea' }} value={stored} onChange={onChange} />,
      );
      // Typed at the end of whatever the editor shows: the issue's repro. A
      // one-line box shows the flattened text, so it would emit that.
      const editor = container.querySelector('input, textarea') as HTMLTextAreaElement;
      fireEvent.change(editor, { target: { value: `${editor.value}!` } });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toBe(`${stored}!`);
    });
  }

  it('takes the entered field’s focus, like the other routed editors', () => {
    const { container } = render(
      <InlineFieldInput field={{ name: 'notes', type: 'textarea' }} value={MULTI_LINE} onChange={vi.fn()} autoFocus />,
    );
    expect(textareaIn(container)).toBe(document.activeElement);
  });
});

// ---------------------------------------------------------------------------
// The two detail hosts open it
// ---------------------------------------------------------------------------

const textareaSchema = { fields: { notes: { type: 'textarea', label: 'Notes' } } };
const notesSection = { fields: [{ name: 'notes', label: 'Notes' }] } as unknown as DetailViewSection;

describe('objectui#11562 — both detail hosts open the multi-line editor', () => {
  it('the details body shows the inline-edit affordance on a textarea row', () => {
    render(
      <DetailSection section={notesSection} data={{ notes: MULTI_LINE }} objectSchema={textareaSchema} onEnterInlineEdit={vi.fn()} />,
    );
    expect(hasPencil()).toBe(true);
  });

  it('the details body renders one editor for the textarea row in edit mode, seeded byte for byte', () => {
    const { container } = render(
      <DetailSection
        section={notesSection}
        data={{ notes: MULTI_LINE }}
        objectSchema={textareaSchema}
        isEditing
        onEnterInlineEdit={vi.fn()}
      />,
    );
    expect(editors(container)).toHaveLength(1);
    expect(plainInput(container)).toBeNull();
    expect(textareaIn(container)!.value).toBe(MULTI_LINE);
  });

  it('the highlights strip opens the same editor inside the edit session', () => {
    function EnterEdit() {
      const inline = useInlineEdit();
      return <button type="button" onClick={() => inline!.enter('notes')}>enter-edit</button>;
    }
    const { container } = render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={[{ name: 'notes', label: 'Notes' }]} data={{ notes: MULTI_LINE }} objectSchema={textareaSchema} />
        <EnterEdit />
      </InlineEditProvider>,
    );
    fireEvent.click(screen.getByText('enter-edit'));
    expect(plainInput(container)).toBeNull();
    expect(textareaIn(container)!.value).toBe(MULTI_LINE);
  });
});

// ---------------------------------------------------------------------------
// The save reads back unchanged
// ---------------------------------------------------------------------------

describe('objectui#11562 — a textarea save reads back unchanged, line breaks included', () => {
  // The multi-line edit appends a line that ends in a newline too; the
  // single-line control appends words only, so it stays a one-line value.
  const CASES = [
    ['multi-line', MULTI_LINE, 'Follow-up booked.\n'],
    ['single-line', SINGLE_LINE, ' Follow-up booked.'],
  ] as const;
  for (const [label, stored, typed] of CASES) {
    it(`a ${label} value: the PATCH body carries the edit byte for byte, and the refetched record seeds it back`, async () => {
      /** The server's copy of the record; `update` writes through the wire's JSON. */
      const store: Record<string, unknown> = { id: 'r1', notes: stored, updated_at: 'v1' };
      const wire: string[] = [];
      const update = vi.fn(async (_object: string, _id: string, patch: Record<string, unknown>) => {
        const body = JSON.stringify(patch);
        wire.push(body);
        Object.assign(store, JSON.parse(body), { updated_at: 'v2' });
        return {};
      });
      const edited = `${stored}${typed}`;

      /** Stand-in for `DetailView`: the fetched record overlaid with the draft. */
      function Body({ record }: { record: Record<string, unknown> }) {
        const inline = useInlineEdit()!;
        return (
          <>
            <button type="button" onClick={() => inline.enter()}>enter-edit</button>
            <DetailSection
              section={notesSection}
              data={{ ...record, ...inline.draft }}
              objectSchema={textareaSchema}
              isEditing={inline.editing}
              onFieldChange={inline.setField}
            />
          </>
        );
      }
      function Page() {
        const [record, setRecord] = React.useState<Record<string, unknown>>(() => ({ ...store }));
        const refresh = React.useCallback(async () => setRecord({ ...store }), []);
        return (
          <InlineEditProvider canEdit>
            <Body record={record} />
            <InlineEditSaveBar dataSource={{ update }} objectName="lead" recordId="r1" data={record} refresh={refresh} />
          </InlineEditProvider>
        );
      }

      const { container } = render(<Page />);
      fireEvent.click(screen.getByText('enter-edit'));
      // Whatever editor the row renders, the user types onto what it SHOWS.
      const editor = container.querySelector('input, textarea') as HTMLTextAreaElement;
      expect(editor.value).toBe(stored);
      fireEvent.change(editor, { target: { value: `${editor.value}${typed}` } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(wire).toHaveLength(1);
      expect(JSON.parse(wire[0])).toEqual({ notes: edited });
      expect(store.notes).toBe(edited);
      // Save leaves edit mode; re-entering seeds the editor from the refetched
      // record. Editor-agnostic on purpose, like the reads above: the editor's
      // KIND is pinned by the first describe, and this case is about bytes, so
      // the single-line control reads the same before the fix and after it.
      await waitFor(() => expect(container.querySelector('input, textarea')).toBeNull());
      fireEvent.click(screen.getByText('enter-edit'));
      expect((container.querySelector('input, textarea') as HTMLTextAreaElement).value).toBe(edited);
    });
  }
});

// ---------------------------------------------------------------------------
// The grid cell: unchanged, and now the same editor as the row
// ---------------------------------------------------------------------------

describe('objectui#11562 — the grid cell editor is the same TextAreaField, unchanged', () => {
  it('`FieldEditWidget`, which the grid cell editor delegates to, seeds a textarea byte for byte', () => {
    // `ObjectGrid`'s `renderCellEditor` hands a `textarea` cell to
    // `FieldEditWidget`; this file's change does not touch that path. The pin
    // records that the row and the cell now edit with one widget.
    const { container } = render(
      <FieldEditWidget field={{ name: 'notes', type: 'textarea' }} value={MULTI_LINE} onChange={vi.fn()} />,
    );
    expect(textareaIn(container)!.value).toBe(MULTI_LINE);
  });
});
