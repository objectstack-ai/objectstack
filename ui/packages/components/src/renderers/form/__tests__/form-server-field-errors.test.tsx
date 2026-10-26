/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A server rejection that names fields must mark those fields.
 *
 * `@objectstack/objectql`'s validators throw `VALIDATION_FAILED` with
 * `fields[]`, and both the REST layer and the runtime dispatcher serve it as a
 * 400 with those entries intact. The form caught the rejection, showed one
 * generic toast, and dropped `fields[]` — so a user told "Validation failed"
 * had to guess WHICH input was wrong, on a surface that already knows how to
 * mark it and already does exactly that for client-side validation.
 *
 * The sibling test `form-invalid-scroll.test.tsx` pins the client-side half;
 * these two paths now share one implementation, so they must behave alike.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

let toastErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id' as any);
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The wire shape the server sends, as `@objectstack/client` decorates it. */
function validationFailure(fields: Array<{ field: string; code?: string; message?: string }>) {
  const message = fields.map((f) => f.message ?? `${f.field} (${f.code})`).join('; ');
  return Object.assign(new Error(message), {
    code: 'VALIDATION_FAILED',
    httpStatus: 400,
    details: { error: message, code: 'VALIDATION_FAILED', fields, object: 'crm_opportunity' },
  });
}

function renderForm(fields: any[], onSubmit: (data: any) => Promise<unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        fields,
        onSubmit,
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

const FIELDS = [
  { name: 'title', label: 'Title', type: 'input' },
  { name: 'stage', label: 'Stage', type: 'input' },
];

describe('form renderer — server-rejected fields', () => {
  it("writes the server's reason under the offending input", async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      validationFailure([{ field: 'title', code: 'required', message: 'Title is required' }]),
    );
    renderForm(FIELDS, onSubmit);

    submit();

    await waitFor(() => expect(screen.getByText('Title is required')).toBeTruthy());
  });

  it('scrolls and focuses the first rejected field, as a client-side failure does', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      validationFailure([{ field: 'stage', code: 'invalid_option', message: 'Stage is not a valid option' }]),
    );
    const { container } = renderForm(FIELDS, onSubmit);
    const stageWrap = container.querySelector('[data-field="stage"]') as HTMLElement;
    const scrollSpy = vi.fn();
    stageWrap.scrollIntoView = scrollSpy;

    submit();

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    await waitFor(() => expect(stageWrap.contains(document.activeElement)).toBe(true));
  });

  it('raises no toast when every rejected field carries its own message (objectstack#25874)', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      validationFailure([{ field: 'title', message: 'Title is required' }]),
    );
    const { container } = renderForm(FIELDS, onSubmit);
    const titleWrap = container.querySelector('[data-field="title"]') as HTMLElement;

    submit();

    // The reason is written under the input it belongs to…
    await waitFor(() => expect(titleWrap.textContent).toMatch(/Title is required/));
    // …so a toast naming the same field, drawn over the dialog's title, would
    // only repeat it.
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('marks every rejected field, not just the first', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      validationFailure([
        { field: 'title', message: 'Title is required' },
        { field: 'stage', message: 'Stage is not a valid option' },
      ]),
    );
    renderForm(FIELDS, onSubmit);

    submit();

    await waitFor(() => expect(screen.getByText('Title is required')).toBeTruthy());
    expect(screen.getByText('Stage is not a valid option')).toBeTruthy();
  });

  it('falls back to the generic banner when a rejected field has no input to carry it', async () => {
    // A field the form does not render cannot be marked inline. Taking over the
    // failure anyway would silently drop the part the user cannot see, so the
    // top-level message — which names every field — is shown instead.
    const onSubmit = vi.fn().mockRejectedValue(
      validationFailure([
        { field: 'title', message: 'Title is required' },
        { field: 'owner_id', message: 'Owner is required' },
      ]),
    );
    renderForm(FIELDS, onSubmit);

    submit();

    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalled());
    expect(String(toastErrorSpy.mock.calls[0][0])).toMatch(/Owner is required/);
  });

  it('a later client-side refusal retires the previous refusal`s banner and toast (objectstack#25874)', async () => {
    // The client refusal raises no toast of its own any more, so nothing would
    // supersede the earlier server refusal under the shared outcome id: the
    // attempt has to take the stale banner and toast down itself.
    const dismissSpy = vi.spyOn(toast, 'dismiss').mockImplementation(() => 'id' as any);
    const forbidden = Object.assign(new Error('insufficient privileges'), {
      code: 'FORBIDDEN',
      httpStatus: 403,
      details: { error: 'insufficient privileges', code: 'FORBIDDEN' },
    });
    const onSubmit = vi.fn().mockRejectedValue(forbidden);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderForm([{ name: 'title', label: 'Title', type: 'input', required: true }], onSubmit);
    const input = screen.getByLabelText(/title/i);

    fireEvent.change(input, { target: { value: 'Filled' } });
    submit();
    await waitFor(() => expect(screen.getByText(/permission to save/i)).toBeTruthy());

    dismissSpy.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    submit();

    await waitFor(() => expect(screen.queryByText(/permission to save/i)).toBeNull());
    expect(dismissSpy).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('leaves a non-field failure on the generic path', async () => {
    const forbidden = Object.assign(new Error('insufficient privileges'), {
      code: 'FORBIDDEN',
      httpStatus: 403,
      details: { error: 'insufficient privileges', code: 'FORBIDDEN' },
    });
    const onSubmit = vi.fn().mockRejectedValue(forbidden);
    const { container } = renderForm(FIELDS, onSubmit);
    const titleWrap = container.querySelector('[data-field="title"]') as HTMLElement;
    const scrollSpy = vi.fn();
    titleWrap.scrollIntoView = scrollSpy;

    submit();

    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalled());
    // Nothing is attributable to a field, so no input is marked or scrolled to.
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
