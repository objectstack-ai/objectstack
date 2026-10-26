/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11541 — `record:details` edit mode gives a `markdown` field an
 * editor, and that editor is MULTI-line.
 *
 * Before, a markdown row offered no pencil and, with the section in edit mode,
 * no editor at all: `markdown` is in the fields package's shared exclusion, and
 * the detail hosts consult it since #4228. A markdown field that no form names
 * therefore had no editing surface anywhere.
 *
 * #4228 recorded its reason for excluding markdown from the detail row: "heavy
 * editor; a one-line text box is lossy". The one-line text box is this
 * component's terminal input (an `<input type="text">`), and the loss is
 * concrete: the browser strips every line break from the value such an input
 * is seeded with, so one keystroke writes the flattened text back. That is why
 * the detail row routes markdown to the fields package's multi-line
 * `TextAreaField` instead, and why the pins below compare values BYTE for byte with blank
 * lines and a trailing newline in them: a single-line editor cannot pass them.
 *
 * `html` and `richtext` stay excluded, unchanged; the grid cell keeps the
 * exclusion for `markdown` too (pinned in `plugin-grid`'s
 * `inline-edit-options.test.ts`, at the grid's own gate).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import { InlineEditSaveBar } from '../InlineEditSaveBar';
import { InlineFieldInput, INLINE_PLAIN_TEXT_INPUT_TESTID } from '../InlineFieldInput';

/** Blank lines inside, and a trailing newline: the bytes a one-line box drops. */
const STORED = '# Deal notes\n\nFirst paragraph.\n\n- one\n- two\n';
/** The edit appends a section that ends in a newline too. */
const EDITED = `${STORED}\n## Follow-up\n\nSecond paragraph.\n`;

const plainInput = (root: ParentNode = document) =>
  root.querySelector(`[data-testid="${INLINE_PLAIN_TEXT_INPUT_TESTID}"]`);
const editors = (root: ParentNode) => root.querySelectorAll('input, textarea');
const hasPencil = () => screen.queryAllByLabelText('Double-click to edit').length > 0;

beforeAll(() => {
  // Desktop layout — the mobile branch renders its own read-only row shape.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// ---------------------------------------------------------------------------
// The editor itself
// ---------------------------------------------------------------------------

describe('objectui#11541 — InlineFieldInput edits markdown in a multi-line textarea', () => {
  it('renders a textarea seeded with the stored value, byte for byte, never the terminal input', () => {
    const { container } = render(
      <InlineFieldInput field={{ name: 'notes', type: 'markdown' }} value={STORED} onChange={vi.fn()} />,
    );
    expect(plainInput(container)).toBeNull();
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe(STORED);
  });

  it('emits the typed string exactly, newlines included', () => {
    const onChange = vi.fn();
    const { container } = render(
      <InlineFieldInput field={{ name: 'notes', type: 'markdown' }} value={STORED} onChange={onChange} />,
    );
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: EDITED },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(EDITED);
  });

  it('takes the entered field’s focus, like the other routed editors', () => {
    const { container } = render(
      <InlineFieldInput field={{ name: 'notes', type: 'markdown' }} value={STORED} onChange={vi.fn()} autoFocus />,
    );
    expect(container.querySelector('textarea')).toBe(document.activeElement);
  });
});

// ---------------------------------------------------------------------------
// The two detail hosts open it
// ---------------------------------------------------------------------------

const markdownSchema = { fields: { notes: { type: 'markdown', label: 'Notes' } } };

describe('objectui#11541 — both detail hosts offer the markdown editor', () => {
  it('the details body shows the inline-edit affordance on a markdown row', () => {
    render(
      <DetailSection
        section={{ fields: [{ name: 'notes', label: 'Notes' }] } as unknown as DetailViewSection}
        data={{ notes: STORED }}
        objectSchema={markdownSchema}
        onEnterInlineEdit={vi.fn()}
      />,
    );
    expect(hasPencil()).toBe(true);
  });

  it('the details body renders one editor for the markdown row in edit mode', () => {
    const { container } = render(
      <DetailSection
        section={{ fields: [{ name: 'notes', label: 'Notes' }] } as unknown as DetailViewSection}
        data={{ notes: STORED }}
        objectSchema={markdownSchema}
        isEditing
        onEnterInlineEdit={vi.fn()}
      />,
    );
    expect(editors(container)).toHaveLength(1);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(STORED);
  });

  it('the highlights strip opens the same editor inside the edit session', () => {
    function EnterEdit() {
      const inline = useInlineEdit();
      return <button type="button" onClick={() => inline!.enter('notes')}>enter-edit</button>;
    }
    const { container } = render(
      <InlineEditProvider canEdit>
        <HeaderHighlight fields={[{ name: 'notes', label: 'Notes' }]} data={{ notes: STORED }} objectSchema={markdownSchema} />
        <EnterEdit />
      </InlineEditProvider>,
    );
    fireEvent.click(screen.getByText('enter-edit'));
    expect(plainInput(container)).toBeNull();
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(STORED);
  });
});

// ---------------------------------------------------------------------------
// The save reads back unchanged
// ---------------------------------------------------------------------------

describe('objectui#11541 — a markdown save reads back unchanged, newlines included', () => {
  it('the PATCH body carries the edited string byte for byte, and the refetched record seeds it back', async () => {
    /** The server's copy of the record; `update` writes through the wire's JSON. */
    const store: Record<string, unknown> = { id: 'r1', notes: STORED, updated_at: 'v1' };
    const wire: string[] = [];
    const update = vi.fn(async (_object: string, _id: string, patch: Record<string, unknown>) => {
      const body = JSON.stringify(patch);
      wire.push(body);
      Object.assign(store, JSON.parse(body), { updated_at: 'v2' });
      return {};
    });
    const section = { fields: [{ name: 'notes', label: 'Notes' }] } as unknown as DetailViewSection;

    /** Stand-in for `DetailView`: the fetched record overlaid with the draft. */
    function Body({ record }: { record: Record<string, unknown> }) {
      const inline = useInlineEdit()!;
      return (
        <>
          <button type="button" onClick={() => inline.enter()}>enter-edit</button>
          <DetailSection
            section={section}
            data={{ ...record, ...inline.draft }}
            objectSchema={markdownSchema}
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
          <InlineEditSaveBar dataSource={{ update }} objectName="deal" recordId="r1" data={record} refresh={refresh} />
        </InlineEditProvider>
      );
    }

    const { container } = render(<Page />);
    fireEvent.click(screen.getByText('enter-edit'));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe(STORED);
    fireEvent.change(textarea, { target: { value: EDITED } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(wire).toHaveLength(1);
    expect(JSON.parse(wire[0])).toEqual({ notes: EDITED });
    expect(store.notes).toBe(EDITED);
    // Save leaves edit mode; re-entering seeds the editor from the refetched record.
    await waitFor(() => expect(container.querySelector('textarea')).toBeNull());
    fireEvent.click(screen.getByText('enter-edit'));
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(EDITED);
  });
});

// ---------------------------------------------------------------------------
// html / richtext — unchanged: still no editor
// ---------------------------------------------------------------------------

describe('objectui#11541 — `html` and `richtext` still open no editor', () => {
  const MARKUP: Record<string, string> = { html: '<p>a</p>\n<p>b</p>', richtext: '<p>a</p>' };

  for (const type of ['html', 'richtext']) {
    it(`a \`${type}\` row has no affordance, and no editor in edit mode`, () => {
      const schema = { fields: { body: { type, label: 'Body' } } };
      const section = { fields: [{ name: 'body', label: 'Body' }] } as unknown as DetailViewSection;
      render(
        <DetailSection section={section} data={{ body: MARKUP[type] }} objectSchema={schema} onEnterInlineEdit={vi.fn()} />,
      );
      expect(hasPencil()).toBe(false);
      const { container } = render(
        <DetailSection section={section} data={{ body: MARKUP[type] }} objectSchema={schema} isEditing onEnterInlineEdit={vi.fn()} />,
      );
      expect(editors(container)).toHaveLength(0);
    });

    it(`a \`${type}\` highlight opens no editor inside the edit session`, () => {
      function EnterEdit() {
        const inline = useInlineEdit();
        return <button type="button" onClick={() => inline!.enter('body')}>enter-edit</button>;
      }
      const { container } = render(
        <InlineEditProvider canEdit>
          <HeaderHighlight
            fields={[{ name: 'body', label: 'Body' }]}
            data={{ body: MARKUP[type] }}
            objectSchema={{ fields: { body: { type, label: 'Body' } } }}
          />
          <EnterEdit />
        </InlineEditProvider>,
      );
      fireEvent.click(screen.getByText('enter-edit'));
      expect(editors(container)).toHaveLength(0);
    });
  }
});
