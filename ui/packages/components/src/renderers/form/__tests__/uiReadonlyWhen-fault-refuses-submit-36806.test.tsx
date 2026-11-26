/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36806 (REWORK S2) — an EDIT form refuses a submit whose field
 * `uiReadonlyWhen` could not be evaluated, as it does for a faulted
 * `visibleWhen` (objectui#8069).
 *
 * The hand lock is console-only: no server evaluates `uiReadonlyWhen`, so
 * ADR-0137 D2's "the submit refuses what render let through" has this form as
 * its one possible judge. Render holds the field locked (the hand lock fails
 * closed); the refusal says the rule itself must be fixed. A CREATE form never
 * judges the hand lock's predicate (no stored record to read), so it neither
 * locks nor refuses there.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// The layout renderers reach `@object-ui/react-runtime` through a dynamic import;
// pay that load during collection, not inside a clocked case (check:test-source-alias).
import '@object-ui/react-runtime';
// Registers the renderers at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../../../renderers';

beforeEach(() => {
  vi.spyOn(toast, 'error').mockImplementation(() => 'id' as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EDIT = {
  mode: 'edit',
  defaultValues: { stage: 'open', discount: '5' },
  previousValues: { stage: 'open', discount: '5' },
};

function renderForm(
  fields: Array<Record<string, unknown>>,
  onSubmit: (data: unknown) => Promise<unknown>,
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
        submitLabel: 'Save',
        fields,
        onSubmit,
        ...extra,
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /save/i }));
const refusalText = () => screen.queryByRole('alert')?.textContent ?? '';

/** A predicate the engine cannot parse: a fault whatever the record holds. */
const BROKEN = 'record.stage ==';

const base = (discount: Record<string, unknown>) => [
  { name: 'stage', label: 'Stage', type: 'input' },
  { name: 'discount', label: 'Discount', type: 'input', ...discount },
];

describe('objectstack#36806 — a faulted uiReadonlyWhen refuses an edit form\'s submit', () => {
  it('refuses, calls no host, names the field and the rule; the field is drawn locked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ uiReadonlyWhen: BROKEN }), onSubmit, EDIT);
    expect(screen.getByLabelText(/^Discount/)).toHaveAttribute('readonly');

    submit();

    await waitFor(() => expect(refusalText()).toMatch(/uiReadonlyWhen rule of Discount could not be evaluated/));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses on a field that also carries a visibleWhen (the other evaluation path)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ visibleWhen: 'true', uiReadonlyWhen: BROKEN }), onSubmit, EDIT);
    submit();
    await waitFor(() => expect(refusalText()).toMatch(/uiReadonlyWhen rule of Discount could not be evaluated/));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Contract delta N6: the same verdict on both evaluation paths — a field the
  // server lock already holds never has its hand lock judged.
  it('CONTROL — a field readonlyWhen already locks submits, with or without a visibleWhen', async () => {
    for (const extra of [{}, { visibleWhen: 'true' }]) {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const view = renderForm(base({ ...extra, readonlyWhen: "record.stage == 'open'", uiReadonlyWhen: BROKEN }), onSubmit, EDIT);
      submit();
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      view.unmount();
    }
  });

  it('CONTROL — a uiReadonlyWhen that evaluates submits', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ uiReadonlyWhen: "record.stage == 'won'" }), onSubmit, EDIT);
    expect(screen.getByLabelText(/^Discount/)).not.toHaveAttribute('readonly');
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('CONTROL — a create form does not judge it: the field edits and the submit goes through', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ uiReadonlyWhen: BROKEN }), onSubmit);
    expect(screen.getByLabelText(/^Discount/)).not.toHaveAttribute('readonly');
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
