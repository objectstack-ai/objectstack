/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12121 — the boolean seed leaves a server-owned field to the server.
 *
 * The form renderer starts an unsupplied two-state control at `false`
 * (cloud#972), so an untouched switch submits a value instead of nothing. For a
 * boolean whose declared `defaultValue` is a runtime instruction — a CEL
 * envelope such as `{ dialect: 'cel', source: 'true' }` — that seed was the
 * defect: `false` is not empty, so the create payload carried it and
 * `ObjectQL.applyFieldDefaults`, which fills only a key that arrives absent or
 * null, never evaluated the declaration.
 *
 * The seed now skips a field `isServerOwnedValue` (from `@object-ui/core`)
 * calls server-owned on this submit. Pinned on both sides of that line, on the
 * two built-in two-state controls:
 *
 *   1. a CEL-default boolean left untouched submits no value, so the hosts'
 *      `omitServerResolvedDefaults` drops the key; it shows the
 *      "set on save" hint (objectui#12108) and is not refused as empty when
 *      it is `required`;
 *   2. CONTROL, cloud#972 intact: a boolean with no runtime default still
 *      submits `false` when untouched;
 *   3. a value the user sets, `false` included, is submitted as usual;
 *   4. create only: an edit form (one with `previousValues`) still seeds
 *      `false`, because the default was resolved at insert.
 *
 * The declared default rides in `field`, the resolved object-field metadata
 * the object-bound builders stash there — the only spelling of a declared
 * `defaultValue` that reaches this renderer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HINT = 'Set automatically when saved.';

/** The canonical wire shape of a CEL default, as the server serves it. */
const cel = (source: string) => ({ dialect: 'cel', source });

function renderForm(
  fields: any[],
  onSubmit: (data: any) => Promise<unknown> | unknown,
  extra: Record<string, unknown> = {},
) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Save',
        defaultValues: {},
        fields,
        onSubmit,
        ...extra,
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /save/i }));
const row = (name: string) => document.body.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
const control = (name: string) => row(name).querySelector<HTMLButtonElement>('button')!;
const hintOf = (name: string) => row(name).querySelector('[data-server-default-hint]');

describe.each(['switch', 'checkbox'])(
  '%s — the boolean seed skips a server-owned field (objectui#12121)',
  (type) => {
    /** A boolean the server fills on insert, beside a plain one. */
    const fields = (required = false) => [
      {
        name: 'active',
        label: 'Active',
        type,
        required,
        field: { type: 'boolean', defaultValue: cel('true') },
      },
      { name: 'archived', label: 'Archived', type },
    ];

    it('submits no value for an untouched CEL-default boolean, and false for a plain one', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      renderForm(fields(), onSubmit);

      submit();

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      const data = onSubmit.mock.calls[0][0];
      // Not `false`: an empty value is what `omitServerResolvedDefaults` drops.
      expect(data.active).toBeUndefined();
      // CONTROL — cloud#972: the boolean with no runtime default still seeds.
      expect(data).toMatchObject({ archived: false });
    });

    it('shows the "set on save" hint under the unseeded control only', async () => {
      renderForm(fields(), vi.fn());

      expect(control('active').getAttribute('aria-checked')).toBe('false');
      expect(hintOf('active')?.textContent).toBe(HINT);
      expect(hintOf('archived')).toBeNull();
    });

    it('does not refuse a required CEL-default boolean as empty', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      renderForm(fields(true), onSubmit);

      expect(row('active').querySelectorAll('[data-required-marker]')).toHaveLength(0);
      submit();

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0][0].active).toBeUndefined();
      expect(screen.queryByText(/is required/i)).toBeNull();
    });

    it('submits a value the user sets, false included', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      renderForm(fields(), onSubmit);

      fireEvent.click(control('active'));
      await waitFor(() => expect(control('active').getAttribute('aria-checked')).toBe('true'));
      expect(hintOf('active')).toBeNull();
      submit();
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ active: true });

      fireEvent.click(control('active'));
      await waitFor(() => expect(control('active').getAttribute('aria-checked')).toBe('false'));
      submit();
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
      expect(onSubmit.mock.calls[1][0]).toMatchObject({ active: false });
    });

    it('still seeds false on an edit form, where the default was resolved at insert', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      renderForm(fields(), onSubmit, { previousValues: { id: 'r1' } });

      submit();

      await waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ active: false, archived: false });
      expect(hintOf('active')).toBeNull();
    });
  },
);
