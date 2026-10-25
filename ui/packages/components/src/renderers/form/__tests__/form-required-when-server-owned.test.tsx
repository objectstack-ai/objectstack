/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A CREATE form must not re-require a control it deliberately leaves empty
 * (objectui#4085 — the conditional half of #4069).
 *
 * #4069 ruled that a field whose `defaultValue` is a runtime instruction the
 * server resolves per insert (`NOW()` / `current_user`, or a CEL Expression
 * envelope) is SERVER-OWNED on a create form: the control opens empty and the
 * key is omitted from the payload, because `ObjectQL.applyFieldDefaults`
 * resolves the declaration only for a field that arrives absent or null. PR
 * #4084 implemented that on the STATIC `required` flag, in
 * `@object-ui/plugin-form`.
 *
 * `requiredWhen` is resolved HERE instead — reactively, against the live
 * record — so it survived that fix untouched and simply put the requirement
 * back: predicate TRUE on a create form re-required the empty control, and the
 * submit was refused with nothing sensible for the user to type. Ruled
 * 2026-08-11 (#4085): in create mode the two spellings behave identically on a
 * producer-owned field.
 *
 * The suppression lives in the ONE evaluator both layers read
 * (`resolveFieldRuleState`, objectui#4201), so these tests assert the star and
 * the submit together — a fix applied a layer up would drop the asterisk and
 * still refuse the write.
 *
 * The create/edit signal is `FormSchema.previousValues`: set by an edit-mode
 * host only, its ABSENCE is the declared "this is an insert" (objectui#3484).
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

/** Resolves TRUE for every record below — the deadlock state. */
const WHEN_SCHEDULED = "record.status == 'scheduled'";

/**
 * A field as the object-bound builders hand it to this renderer: the resolved
 * object-field metadata rides in `field`, which is the only spelling of a
 * declared `defaultValue` that reaches here.
 */
const remindAt = (defaultValue: unknown) => ({
  name: 'remind_at',
  label: 'Remind at',
  type: 'input',
  requiredWhen: WHEN_SCHEDULED,
  field: { defaultValue },
});

/** Conditionally required with no declared default — the user's to fill. */
const PLAN = { name: 'plan', label: 'Plan', type: 'input', requiredWhen: WHEN_SCHEDULED };

function renderForm(
  fields: any[],
  defaultValues: Record<string, unknown>,
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
        submitLabel: 'Create',
        defaultValues,
        fields,
        onSubmit,
        ...extra,
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('form renderer — `requiredWhen` yields to a producer-owned default on create (#4085)', () => {
  it.each([
    ['a NOW() token', 'NOW()'],
    ['a current_user token', 'current_user'],
    ['a CEL Expression envelope', { dialect: 'cel', source: 'today()' }],
  ])('%s: submit goes through with the control left empty', async (_what, defaultValue) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm([PLAN, remindAt(defaultValue)], { status: 'scheduled', plan: 'ring', remind_at: '' }, onSubmit);

    // Predicate TRUE, control empty — and no asterisk, because the field is
    // not the user's to supply on this submit.
    expect(screen.getByLabelText(/remind at/i)).not.toHaveAttribute('aria-required', 'true');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('keeps enforcing a conditionally-required field that declares NO default', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm([PLAN, remindAt('NOW()')], { status: 'scheduled', plan: '', remind_at: '' }, onSubmit);

    // The contrast: same predicate, same empty control, but nothing declared
    // that the server will supply. The suppression reads the default, not the
    // mode alone.
    expect(screen.getByLabelText(/plan/i)).toHaveAttribute('aria-required', 'true');
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps enforcing when the declared default is a STATIC literal', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    // A static default IS seeded into the control (#4068), so an empty one
    // means the user emptied it — a removed value, not one the producer will
    // supply.
    renderForm([remindAt('2026-01-01')], { status: 'scheduled', remind_at: '' }, onSubmit);

    expect(screen.getByLabelText(/remind at/i)).toHaveAttribute('aria-required', 'true');
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('EDIT mode is untouched — `previousValues` present means the token was resolved at insert', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [remindAt('NOW()')],
      { status: 'scheduled', remind_at: '' },
      onSubmit,
      // The declared edit-mode signal (objectui#3484). Blanking a column on a
      // persisted row is a real removal, so the predicate means what it says.
      { previousValues: { status: 'scheduled', remind_at: '2026-01-01T00:00:00Z' } },
    );

    expect(screen.getByLabelText(/remind at/i)).toHaveAttribute('aria-required', 'true');
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not touch a field the predicate leaves FALSE either way', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm([remindAt('NOW()')], { status: 'draft', remind_at: '' }, onSubmit);

    expect(screen.getByLabelText(/remind at/i)).not.toHaveAttribute('aria-required', 'true');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('a value the user DOES type is still submitted — the RULE yields, not the field', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm([remindAt('NOW()')], { status: 'scheduled', remind_at: '' }, onSubmit);

    fireEvent.change(screen.getByLabelText(/remind at/i), { target: { value: 'typed by hand' } });
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ remind_at: 'typed by hand' });
  });
});
