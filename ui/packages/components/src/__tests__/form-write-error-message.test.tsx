/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#3821 — a rejected write is user-facing copy, not server
 * diagnostics.
 *
 * The form used to render `error.message` verbatim, so a sharing/RLS denial
 * surfaced in the dialog and the toast as
 * `FORBIDDEN: insufficient privileges to update showcase_private_note
 * pi-TgoJ4_DM55Fqz` — untranslated, and leaking the object's machine name and
 * the record id to whoever hit it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

const SCHEMA = {
  type: 'form',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
  submitText: 'Save',
} as any;

function forbiddenError() {
  const err: any = new Error(
    'FORBIDDEN: insufficient privileges to update showcase_private_note pi-TgoJ4_DM55Fqz',
  );
  err.code = 'FORBIDDEN';
  err.status = 403;
  return err;
}

function renderForm(onAction: () => Promise<unknown>) {
  const Form = ComponentRegistry.get('form')!;
  // `onAction` is a PROP on the renderer, not part of the schema.
  return render(<Form schema={SCHEMA} onAction={onAction} />);
}

describe('form write errors are user-facing copy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('shows a permission message instead of the raw FORBIDDEN text', async () => {
    renderForm(async () => { throw forbiddenError(); });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    const alert = await screen.findByText(/permission to save/i);
    expect(alert).toBeInTheDocument();
  });

  it('never leaks the object machine name or the record id', async () => {
    const { container } = renderForm(async () => { throw forbiddenError(); });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await screen.findByText(/permission to save/i);
    expect(container.textContent).not.toMatch(/showcase_private_note/);
    expect(container.textContent).not.toMatch(/pi-TgoJ4_DM55Fqz/);
    expect(container.textContent).not.toMatch(/FORBIDDEN/);
  });

  it('keeps the server text for non-permission failures — it is the useful part', async () => {
    renderForm(async () => { throw new Error('Title must be unique'); });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/title must be unique/i)).toBeInTheDocument();
  });

  it('falls back to a generic localized message when the error carries no text', async () => {
    renderForm(async () => { throw {}; });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
  });
});

/**
 * objectui#5210 — the consumer half of objectstack#9934, ruled 2026-08-19.
 *
 * #3821 (above) is preserved: the generic substitution still governs every
 * refusal the author did not opt in. What changes is that an author CAN opt in
 * — `userMessage` marks a refusal message as addressed to the end user, and a
 * marked message is rendered verbatim. The external report behind this card
 * (@baozhoutao, 11 hook guards) is the marked case; the unmarked case below is
 * the control that keeps this from becoming the leak #3821 removed.
 */
describe('a producer-marked refusal reaches the user', () => {
  const MARKED = '该记录需要财务审批,请联系你的主管。';

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  function markedForbidden() {
    // The wire shape `@objectstack/client` hands the form: the diagnostic stays
    // on `message`, the author's text arrives on its own declared field.
    const err = forbiddenError();
    err.userMessage = MARKED;
    return err;
  }

  it('renders the marked message verbatim instead of the generic 403 string', async () => {
    renderForm(async () => { throw markedForbidden(); });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(MARKED)).toBeInTheDocument();
    expect(screen.queryByText(/permission to save/i)).not.toBeInTheDocument();
  });

  it('still withholds the diagnostic channel when a marking is present', async () => {
    // The marking is ADDITIVE — it does not turn the 403 branch chatty. The
    // machine name, the record id and the FORBIDDEN prefix stay out of the UI.
    const { container } = renderForm(async () => { throw markedForbidden(); });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await screen.findByText(MARKED);
    expect(container.textContent).not.toMatch(/showcase_private_note/);
    expect(container.textContent).not.toMatch(/pi-TgoJ4_DM55Fqz/);
    expect(container.textContent).not.toMatch(/FORBIDDEN/);
  });

  it('CONTROL: an unmarked 403 keeps the generic substitution (#3821 not reverted)', async () => {
    renderForm(async () => { throw forbiddenError(); });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/permission to save/i)).toBeInTheDocument();
  });

  it('renders a marked message on a NON-403 status — the marking is status-agnostic', async () => {
    // 403 is where this was reported, not a fence the contract draws. A guard
    // that refuses with 409/400/500 and marks its text is answered the same way.
    renderForm(async () => {
      throw Object.assign(new Error('CONFLICT: version mismatch on sys_record 42'), {
        code: 'CONFLICT',
        status: 409,
        userMessage: 'Someone edited this record while you were working — reload before saving.',
      });
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/reload before saving/i)).toBeInTheDocument();
    expect(screen.queryByText(/CONFLICT/)).not.toBeInTheDocument();
  });

  it('CONTROL: an unmarked non-403 still shows the server message (unchanged path)', async () => {
    renderForm(async () => { throw new Error('Title must be unique'); });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(await screen.findByText(/title must be unique/i)).toBeInTheDocument();
  });
});
