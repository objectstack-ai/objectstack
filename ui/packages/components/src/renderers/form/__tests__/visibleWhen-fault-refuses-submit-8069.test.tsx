/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8069 — the form renderer refuses a submit whose field `visibleWhen`
 * could not be evaluated, naming the field and the rule; `requiredWhen` /
 * `readonlyWhen` faults go to the server, whose ADR-0137 D2 refusal lands
 * beside the input.
 *
 * ## The ruling this pins (Q1 = B, one judge per rule)
 *
 * No server evaluates a field's `visibleWhen`, so its fail-open render
 * direction (ADR-0137 D3: a faulting rule SHOWS the field) is the only verdict
 * anywhere — without a refusal at submit it is a silent grant. The server DOES
 * evaluate `requiredWhen` / `readonlyWhen` and refuses a faulted one itself
 * (D2), so the client keeps their render direction and warning, lets the
 * submit through, and shows the server's field-attributed refusal inline
 * through the existing `extractFieldErrors` → `form.setError` path.
 *
 * ## The server end, transcribed
 *
 * `SERVER_D2_REFUSAL` is the envelope `@objectstack/objectql`'s rule validator
 * builds for an unevaluable field rule at the spec 17.5.0 tag (objectstack
 * `0f6dcac5e9`, `unevaluableFieldRuleError` → `unevaluableRuleError`):
 * `code: 'rule_violation'`, a message of the shape "Field '<name>' requiredWhen
 * could not be evaluated (…) — write rejected.", and `constraint.rule` naming
 * the SLOT with `constraint.reason: 'unevaluable'` — served as
 * `VALIDATION_FAILED` with `fields[]`, as `@objectstack/client` decorates it.
 * objectql is not a dependency of this repository, so the pin carries the wire
 * shape rather than calling the validator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../../../renderers';

let toastError: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id' as never);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The server's ADR-0137 D2 refusal for one field rule, as the client sees it. */
function SERVER_D2_REFUSAL(field: string, slot: 'requiredWhen' | 'readonlyWhen') {
  const message = `Field '${field}' ${slot} could not be evaluated (the predicate names a key this record does not have) — write rejected.`;
  const fields = [
    {
      field,
      code: 'rule_violation',
      message,
      constraint: { rule: slot, reason: 'unevaluable', fault: 'the predicate names a key this record does not have' },
    },
  ];
  return Object.assign(new Error(message), {
    code: 'VALIDATION_FAILED',
    httpStatus: 400,
    details: { error: message, code: 'VALIDATION_FAILED', fields, object: 'crm_deal' },
  });
}

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
        submitLabel: 'Create',
        fields,
        onSubmit,
        ...extra,
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));
const lastToast = () => String(toastError.mock.calls.at(-1)?.[0] ?? '');

/** A predicate the engine cannot parse: a fault whatever the record holds. */
const BROKEN = 'record.stage ==';

const base = (discount: Record<string, unknown>) => [
  { name: 'stage', label: 'Stage', type: 'input' },
  { name: 'discount', label: 'Discount', type: 'input', ...discount },
];

describe('objectui#8069 — a faulted visibleWhen refuses the submit', () => {
  it('refuses, calls no host, and names the field and the rule — the field stays drawn (D3)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ visibleWhen: BROKEN }), onSubmit);
    expect(screen.getByLabelText('Discount')).toBeTruthy();

    submit();

    await waitFor(() => expect(lastToast()).toMatch(/visibleWhen rule of Discount could not be evaluated/));
    expect(screen.getByText(/visibleWhen rule of Discount could not be evaluated/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses BEFORE client validation: a required empty field is not asked for first', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'stage', label: 'Stage', type: 'input', required: true },
        { name: 'discount', label: 'Discount', type: 'input', visibleWhen: BROKEN },
      ],
      onSubmit,
    );

    submit();

    await waitFor(() => expect(lastToast()).toMatch(/visibleWhen rule of Discount/));
    expect(toastError.mock.calls.some((c: unknown[]) => /check the highlighted fields/.test(String(c[0])))).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('CONTROL — the same field with a rule that evaluates submits', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ visibleWhen: "record.stage == null" }), onSubmit);
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('a STORED blank visibleWhen is refused too — ADR-0137 D2: "a blank predicate takes this path too"', async () => {
    // A new one cannot be authored (the form schema's triad wire refuses it at
    // parse, D1); one already stored meets the submit refusal. The field is
    // still drawn — a blank rule renders like no rule (D3).
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ visibleWhen: '' }), onSubmit);
    expect(screen.getByLabelText('Discount')).toBeTruthy();
    submit();
    await waitFor(() => expect(lastToast()).toMatch(/visibleWhen rule of Discount could not be evaluated/));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('[blank]'))).toBe(true);
  });

  it('control — a blank view-level visibleOn is a layout GATE: no gate plus a diagnostic, never a refusal (D4)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ visibleOn: '' }), onSubmit);
    expect(screen.getByLabelText('Discount')).toBeTruthy();
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('[blank]'))).toBe(true);
  });

  it('a section-divider row’s visibleWhen is a layout gate, not a field rule: it does not refuse', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: '__section_extra', label: 'Extra', type: 'section-divider', visibleWhen: BROKEN },
        { name: 'stage', label: 'Stage', type: 'input' },
      ],
      onSubmit,
    );
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('ACCEPTED RESIDUAL — a visibleWhen reading previous is refused on a CREATE form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ visibleWhen: "previous.stage == 'won'" }), onSubmit);
    submit();
    await waitFor(() => expect(lastToast()).toMatch(/visibleWhen rule of Discount/));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('CONTROL — the same previous-reading visibleWhen submits on an EDIT form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(base({ visibleWhen: "previous.stage == 'won'" }), onSubmit, {
      mode: 'edit',
      defaultValues: { stage: 'won', discount: '5' },
      previousValues: { stage: 'won', discount: '5' },
    });
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe('objectui#8069 — requiredWhen / readonlyWhen faults are the SERVER’s to refuse', () => {
  it('a faulted requiredWhen is not refused on the client; the server D2 refusal lands beside the input', async () => {
    const onSubmit = vi.fn().mockRejectedValue(SERVER_D2_REFUSAL('discount', 'requiredWhen'));
    const { container } = renderForm(base({ requiredWhen: BROKEN }), onSubmit);

    submit();

    // The client let it through — one judge per rule.
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // …and the server's refusal is written under the input it names.
    const discount = container.querySelector('[data-field="discount"]') as HTMLElement;
    await waitFor(() =>
      expect(within(discount).getByText(/requiredWhen could not be evaluated/)).toBeTruthy(),
    );
    // Fully attributed, so no page-level banner repeats it.
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').not.toMatch(/write rejected/);
  });

  it('a faulted readonlyWhen on an EDIT form is not refused on the client either', async () => {
    const onSubmit = vi.fn().mockRejectedValue(SERVER_D2_REFUSAL('discount', 'readonlyWhen'));
    const { container } = renderForm(base({ readonlyWhen: BROKEN }), onSubmit, {
      mode: 'edit',
      defaultValues: { stage: 'open', discount: '5' },
      previousValues: { stage: 'open', discount: '5' },
    });

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const discount = container.querySelector('[data-field="discount"]') as HTMLElement;
    await waitFor(() =>
      expect(within(discount).getByText(/readonlyWhen could not be evaluated/)).toBeTruthy(),
    );
  });
});
