/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A refused save raises ONE error toast (objectui#13340).
 *
 * The console's record form (`ModalForm`, `RecordFormPage`'s `ObjectForm`)
 * hands this renderer an `onSubmit` that writes through the data source and,
 * on a refusal, rethrows it. This renderer is the one that reports it: the
 * banner above the fields, plus a toast for when the banner has scrolled out
 * of view. The toast is raised under the form's own outcome id, so a retry
 * that is refused again REPLACES the previous toast instead of stacking a
 * second copy beside it.
 *
 * Pinned on the toast calls themselves (every `toast.error` this form makes,
 * undeduplicated), not on what sonner ends up showing, so a second raiser here
 * cannot hide behind sonner's id replacement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

const REFUSAL = 'A record with this value already exists';

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

/** The refusal the server sends for a duplicate unique value, as the adapter throws it. */
const refuse = vi.fn(async () => {
  throw Object.assign(new Error(REFUSAL), { status: 409, code: 'DUPLICATE_VALUE' });
});

function renderRefusingForm() {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        fields: [{ name: 'code', label: 'Code', type: 'input' }],
        onSubmit: refuse,
      }}
    />,
  );
}

const create = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('form renderer — one refusal, one error toast (objectui#13340)', () => {
  it('a refused submit raises exactly one error toast, with the server`s sentence', async () => {
    renderRefusingForm();
    create();

    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(1));
    // The banner is the settle signal: it is set in the same catch as the toast.
    await screen.findByText(REFUSAL);
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
    expect(toastErrorSpy.mock.calls[0][0]).toBe(REFUSAL);
  });

  it('a refused retry raises one more, under the same id, so it replaces the first', async () => {
    refuse.mockClear();
    renderRefusingForm();
    create();
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(1));

    create();
    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(2));

    const [first, second] = toastErrorSpy.mock.calls.map((c: unknown[]) => (c[1] as { id?: unknown } | undefined)?.id);
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });
});
