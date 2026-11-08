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
import { SuggestedFieldsContext } from '../suggested-fields-context';

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
