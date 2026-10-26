/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Conditional required (`requiredWhen`) has to reach BOTH layers, and until
 * objectui#4161 it reached only one.
 *
 * The renderer recomputes `resolveFieldRuleState` on every render, so the
 * DISPLAY layer — the asterisk and `aria-required` — tracks the predicate
 * live. The VALIDATION layer did not: the `validate.required` entry is handed
 * to react-hook-form as a `<Controller rules>` prop, and RHF snapshots those
 * rules into `control._fields[name]._f` from a `useEffect` keyed
 * `[name, control, isArrayField, shouldUnregister]` — i.e. once, at mount.
 * A predicate that flips FALSE after mount therefore dropped the star while
 * the mount-time required validator kept firing: submit was refused with
 * "<field> is required" and no write was ever issued.
 *
 * These tests pin the two layers to the SAME verdict, in both directions —
 * a fix that merely stopped enforcing conditional required would pass the
 * flip-to-FALSE case and fail the flip-to-TRUE one.
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
        mode: 'create',
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

/** The reporter's exact predicate shape: `B` is required until `A` is "x". */
const REPORTED_PREDICATE = '!(has(record.a) && record.a == "x")';

describe('form renderer — `requiredWhen` at SUBMIT time (objectui#4161)', () => {
  it('lets submit through once the predicate flips FALSE after mount', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'a', label: 'Kind', type: 'input' },
        { name: 'b', label: 'Owner', type: 'input', requiredWhen: REPORTED_PREDICATE },
      ],
      { a: '', b: '' },
      onSubmit,
    );

    const owner = () => screen.getByLabelText(/owner/i);
    // Mount: `a` is blank, so the predicate is TRUE and `b` is required.
    expect(owner()).toHaveAttribute('aria-required', 'true');

    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: 'x' } });

    // The DISPLAY layer flips — this half always worked, and asserting it here
    // is what makes the failure below a *divergence* between the two layers
    // rather than "the predicate never re-evaluated at all".
    await waitFor(() => expect(owner()).not.toHaveAttribute('aria-required'));

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ a: 'x', b: '' });
    expect(screen.queryByText(/is required/i)).toBeNull();
  });

  it('still refuses submit when the predicate flips TRUE after mount', async () => {
    // The symmetric direction. Dropping conditional required entirely would
    // make the case above pass and this one fail.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'a', label: 'Kind', type: 'input' },
        { name: 'b', label: 'Owner', type: 'input', requiredWhen: REPORTED_PREDICATE },
      ],
      { a: 'x', b: '' },
      onSubmit,
    );

    const owner = () => screen.getByLabelText(/owner/i);
    expect(owner()).not.toHaveAttribute('aria-required');

    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: 'other' } });
    await waitFor(() => expect(owner()).toHaveAttribute('aria-required', 'true'));

    submit();

    await waitFor(() => expect(screen.getByText(/owner is required/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('re-opens submit after a blocked attempt once the predicate flips FALSE', async () => {
    // The reporter's live sequence: the refusal is already on screen when the
    // user fixes the condition. Clearing the stale message is not enough —
    // the next submit has to actually reach the write.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'a', label: 'Kind', type: 'input' },
        { name: 'b', label: 'Owner', type: 'input', requiredWhen: REPORTED_PREDICATE },
      ],
      { a: '', b: '' },
      onSubmit,
    );

    submit();
    await waitFor(() => expect(screen.getByText(/owner is required/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: 'x' } });
    await waitFor(() => expect(screen.queryByText(/owner is required/i)).toBeNull());

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('keeps enforcing a STATICALLY required field (control)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'a', label: 'Kind', type: 'input' },
        { name: 'b', label: 'Owner', type: 'input', required: true },
      ],
      { a: '', b: '' },
      onSubmit,
    );

    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: 'x' } });

    submit();

    await waitFor(() => expect(screen.getByText(/owner is required/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves an edit form whose predicate was already FALSE at mount (control)', async () => {
    // The reporter's own control experiment: the edit dialog opened with
    // `a = "x"` already set saves fine, which is what localized the defect to
    // the mount-time snapshot rather than to the predicate itself.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'a', label: 'Kind', type: 'input' },
        { name: 'b', label: 'Owner', type: 'input', requiredWhen: REPORTED_PREDICATE },
      ],
      { a: 'x', b: '' },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByText(/is required/i)).toBeNull();
  });
});
