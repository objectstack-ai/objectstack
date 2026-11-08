/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28104 — a form opened on an AI chat draft marks each field the
 * draft filled 「AI 建议」 until the person edits it, and never submits on its
 * own.
 *
 * The host names the fields through `SuggestedFieldsContext`; the console's
 * create page does so for "Open the full form" on a record-write card. Pinned:
 *
 *   1. a named field holding its opening value carries the mark, inside the
 *      field's description (so the control's `aria-describedby` reaches it);
 *   2. the person's first edit takes the mark away;
 *   3. a field the set does not name, and a form with no provider (CONTROL),
 *      draw no mark;
 *   4. mounting the marked form submits nothing; only Save does.
 *
 * Direction, written before the run: with the renderer not reading the
 * context, cells 1 and 2 RED (no mark ever drawn); 3 and 4 GREEN both ways.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';
// The layout renderers reach `@object-ui/react-runtime` through a dynamic import;
// pay that load during collection, not inside a clocked case (check:test-source-alias).
import '@object-ui/react-runtime';
import { SuggestedFieldChangesContext, SuggestedFieldsContext } from '../suggested-fields-context';

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MARK = 'AI suggestion';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'input' },
  { name: 'phone', label: 'Phone', type: 'input' },
  { name: 'note', label: 'Note', type: 'input' },
];

function renderForm(suggested: ReadonlySet<string> | undefined, onSubmit = vi.fn()) {
  const Form = ComponentRegistry.get('form')!;
  const form = (
    <Form
      schema={{
        type: 'form',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Save',
        defaultValues: { name: '张伟', phone: '13900001111', note: 'typed by the form' },
        fields: FIELDS,
        onSubmit,
      }}
    />
  );
  render(
    suggested ? <SuggestedFieldsContext.Provider value={suggested}>{form}</SuggestedFieldsContext.Provider> : form,
  );
  return onSubmit;
}

/** The mark drawn for the field whose control is labelled `label`, or null. */
function markOf(label: string): Element | null {
  const control = screen.getByLabelText(label);
  const describedBy = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  for (const id of describedBy) {
    const mark = document.getElementById(id)?.querySelector('[data-ai-suggested="true"]');
    if (mark) return mark;
  }
  return null;
}

describe('form — the AI-suggested mark (objectstack#28104)', () => {
  it('marks a named field holding its opening value, in the description the control names', () => {
    renderForm(new Set(['name', 'phone']));
    expect(markOf('Name')?.textContent).toBe(MARK);
    expect(markOf('Phone')?.textContent).toBe(MARK);
  });

  it('the first edit takes the mark away; the untouched field keeps it', async () => {
    renderForm(new Set(['name', 'phone']));
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '13800000000' } });
    await waitFor(() => expect(markOf('Phone')).toBeNull());
    expect(markOf('Name')?.textContent).toBe(MARK);
  });

  it('a field the set does not name carries no mark', () => {
    renderForm(new Set(['name']));
    expect(markOf('Note')).toBeNull();
    expect(markOf('Phone')).toBeNull();
  });

  it('CONTROL: with no provider no field is marked', () => {
    renderForm(undefined);
    expect(document.querySelector('[data-ai-suggested="true"]')).toBeNull();
  });

  it('never submits on its own: mounting submits nothing, Save submits the values', async () => {
    const onSubmit = renderForm(new Set(['name', 'phone']));
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: '张伟', phone: '13900001111' });
  });
});

/**
 * objectstack#28106 — an EDIT form opened on an AI chat update's proposed
 * values (`SuggestedFieldChangesContext`): the stored record is the opening
 * value, each proposed value is applied over it as an unsaved change, and the
 * field shows the same mark, the stored value it replaces (before → after)
 * and a revert. Pinned:
 *
 *   1. a proposed change lands in the control, marked, with "Was: <stored>";
 *      an unproposed field and a proposal equal to the stored value show none;
 *   2. revert puts the stored value back and takes mark, before line and
 *      revert away; the person's own edit takes them away too;
 *   3. the form reads DIRTY once the changes are applied (the discard guard
 *      hears it), and nothing is applied to a read-only field or a field the
 *      form does not draw;
 *   4. mounting submits nothing; Save submits the applied change;
 *   5. CONTROL: with no provider the form opens on the stored record unmarked.
 *
 * Direction, written before the run: with the renderer not applying the
 * changes, cells 1, 2, 3 (dirty) and 4 (payload) RED; 5 GREEN both ways.
 */
const STORED = { name: '张伟', phone: '13900001111', note: 'stored note', status: 'new' };
const EDIT_FIELDS = [
  { name: 'name', label: 'Name', type: 'input' },
  { name: 'phone', label: 'Phone', type: 'input' },
  { name: 'note', label: 'Note', type: 'input', readonly: true },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'New', value: 'new' },
      { label: 'Contacted', value: 'contacted' },
    ],
  },
];

function renderEdit(
  changes: ReadonlyMap<string, unknown> | undefined,
  onSubmit = vi.fn(),
  onDirtyChange = vi.fn(),
) {
  const Form = ComponentRegistry.get('form')!;
  const form = (
    <Form
      schema={{
        type: 'form',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Save',
        defaultValues: STORED,
        fields: EDIT_FIELDS,
        onSubmit,
        onDirtyChange,
      }}
    />
  );
  render(
    changes ? <SuggestedFieldChangesContext.Provider value={changes}>{form}</SuggestedFieldChangesContext.Provider> : form,
  );
  return { onSubmit, onDirtyChange };
}

/** The "Was: …" line drawn for the field whose control is labelled `label`, or null. */
function beforeOf(label: string): string | null {
  const control = screen.getByLabelText(label);
  const describedBy = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  for (const id of describedBy) {
    const line = document.getElementById(id)?.querySelector('[data-ai-before="true"]');
    if (line) return line.textContent;
  }
  return null;
}

const revertButtons = () => Array.from(document.querySelectorAll('[data-ai-revert="true"]'));

describe('form — AI-proposed changes on an edit form (objectstack#28106)', () => {
  it('a proposed change lands in the control, marked, with the stored value it replaces', () => {
    renderEdit(new Map<string, unknown>([['phone', '13800000000'], ['status', 'contacted'], ['name', '张伟']]));
    expect(screen.getByLabelText('Phone')).toHaveValue('13800000000');
    expect(markOf('Phone')?.textContent).toBe(MARK);
    expect(beforeOf('Phone')).toBe('Was: 13900001111');
    // An option field reads the stored option's label.
    expect(beforeOf('Status')).toBe('Was: New');
    // A proposal equal to the stored value is no change: no mark, no revert for it.
    expect(markOf('Name')).toBeNull();
    expect(revertButtons()).toHaveLength(2);
  });

  it('revert puts the stored value back and takes the mark, the before line and the revert away', async () => {
    renderEdit(new Map([['phone', '13800000000']]));
    fireEvent.click(revertButtons()[0]);
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('13900001111'));
    expect(markOf('Phone')).toBeNull();
    expect(beforeOf('Phone')).toBeNull();
    expect(revertButtons()).toHaveLength(0);
  });

  it('the person\'s own edit takes the mark away and keeps their value', async () => {
    renderEdit(new Map([['phone', '13800000000']]));
    expect(markOf('Phone')?.textContent).toBe(MARK);
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '13700000000' } });
    await waitFor(() => expect(markOf('Phone')).toBeNull());
    expect(screen.getByLabelText('Phone')).toHaveValue('13700000000');
  });

  it('reads dirty once applied; a read-only field and an undrawn field are left alone', async () => {
    const { onSubmit, onDirtyChange } = renderEdit(
      new Map([['phone', '13800000000'], ['note', 'ai note'], ['secret', 'x']]),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByLabelText('Note')).toHaveValue('stored note');
    expect(markOf('Note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ phone: '13800000000', note: 'stored note' });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('secret');
  });

  it('never submits on its own: mounting submits nothing, Save submits the applied change', async () => {
    const { onSubmit } = renderEdit(new Map([['phone', '13800000000']]));
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ phone: '13800000000', name: '张伟' });
  });

  it('a field a rule locks on the stored record (`readonlyWhen`) is left alone; an unlocked one beside it applies', () => {
    const Form = ComponentRegistry.get('form')!;
    const stored = { status: 'closed', type: 'quality', phone: '13900001111' };
    render(
      <SuggestedFieldChangesContext.Provider value={new Map([['type', 'ai type'], ['phone', '13800000000']])}>
        <Form
          schema={{
            type: 'form',
            showSubmit: false,
            showCancel: false,
            defaultValues: stored,
            previousValues: stored,
            fields: [
              { name: 'status', label: 'Status', type: 'input' },
              { name: 'type', label: 'Type', type: 'input', readonlyWhen: "previous.status != 'draft'" },
              { name: 'phone', label: 'Phone', type: 'input' },
            ],
          }}
        />
      </SuggestedFieldChangesContext.Provider>,
    );
    expect(screen.getByLabelText(/^Type$/)).toHaveValue('quality');
    expect(markOf('Type')).toBeNull();
    expect(screen.getByLabelText('Phone')).toHaveValue('13800000000');
    expect(revertButtons()).toHaveLength(1);
  });

  it('CONTROL: with no provider the form opens on the stored record, unmarked and clean', async () => {
    const { onDirtyChange } = renderEdit(undefined);
    expect(screen.getByLabelText('Phone')).toHaveValue('13900001111');
    expect(document.querySelector('[data-ai-suggested="true"]')).toBeNull();
    expect(revertButtons()).toHaveLength(0);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });
});
