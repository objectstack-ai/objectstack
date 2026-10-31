/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A refused save is said ONCE (objectui#13340, objectstack-ai/objectstack#27520).
 *
 * The console's record form (`ModalForm`, `RecordFormPage`'s `ObjectForm`)
 * hands this renderer an `onSubmit` that writes through the data source and,
 * on a refusal, rethrows it. This renderer is the one that reports it: the
 * banner above the fields, brought into view each time it is raised, and no
 * error toast repeating it. A retry that is refused again keeps that one
 * banner rather than stacking a second message beside it.
 *
 * Pinned on the toast calls themselves (every `toast.error` this form makes,
 * undeduplicated), not on what sonner ends up showing, so a raiser here
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
let scrolled: Element[];

beforeEach(() => {
  toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id' as any);
  scrolled = [];
  (Element.prototype as any).scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
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

describe('form renderer — one refusal, one message (objectui#13340, objectstack-ai/objectstack#27520)', () => {
  it('a refused submit draws one banner, scrolled into view, and raises no error toast', async () => {
    renderRefusingForm();
    create();

    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(1));
    // The banner is the settle signal: it is set in the same catch.
    const banner = (await screen.findByText(REFUSAL)).closest('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await waitFor(() => expect(scrolled).toContain(banner));
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('a refused retry keeps one banner, brings it into view again, and still raises no toast', async () => {
    refuse.mockClear();
    renderRefusingForm();
    create();
    await screen.findByText(REFUSAL);
    await waitFor(() => expect(scrolled.length).toBe(1));

    create();
    await waitFor(() => expect(refuse).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(scrolled.length).toBe(2));

    expect(screen.getAllByText(REFUSAL)).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });
});
