/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6236 — the section grouping contract (maintainer ruling 2026-08-27).
 *
 * A `section-divider` row that CLAIMS its member fields (`fields: string[]` —
 * the membership shape `FormFieldTab.fields` / `FormFieldPane.fields` already
 * model) gates its WHOLE group: a false section predicate hides the heading
 * AND every claimed field. Ruled semantics, pinned case by case below:
 *
 *   1. Visibility decides what is DRAWN and nothing else (console precedent,
 *      2026-08-22 ruling after #5594) — a hidden section's values still
 *      submit.
 *   2. A hidden section's fields SKIP client-side validation — a user must
 *      never be blocked by an error pointing at a control they cannot see
 *      (the objectui#6110 defect shape). The server-side contract remains the
 *      loud floor for genuinely-required data.
 *   3. A divider WITHOUT a claim keeps the pre-#6236 contract — its predicate
 *      gates only the heading. That is deliberate compatibility (the
 *      plugin-form synthesis sites do not stamp claims yet), not an oversight.
 *
 * ## Why the DENIED rows assert the FIELD and not only the heading
 *
 * The heading half is predicate-scope-parity-6010's `sectionSurface` row and
 * has been true since #6111. The deliverable HERE is the other half — the
 * claimed fields going with it — which is exactly what the pre-#6236 renderer
 * did not do, so every DENIED assertion below is red on the old code in the
 * SHOWN direction.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Revert the `hiddenSectionFieldNames.has(name)` member check in
 * `renderFormField` and: the DENIED group rows go red in the SHOWN direction
 * (claimed fields come back), and the validation rows go red in the BLOCKED
 * direction (the hidden required field starts refusing the submit again). The
 * values-still-submit row stays GREEN — value retention comes from
 * react-hook-form keeping unmounted values, which the revert does not touch —
 * so it is a semantics pin, not a differentiator, and the same holds for the
 * claim-less compat row and every ALLOWED/FAULTED control.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

/**
 * The canonical wire shape — `@objectstack/spec` normalizes an authored
 * predicate into a `{ dialect: 'cel' }` envelope at parse (ADR-0089 D2). Same
 * spelling as predicate-scope-parity-6010, on purpose: one authored text, one
 * verdict, every surface.
 */
const cel = (source: string) => ({ dialect: 'cel', source });

/** THE authored section predicate. */
const GATE = cel("'sales_manager' in current_user.positions");

/** A root NOTHING binds — "faulted" must be unambiguous. */
const UNBOUND_ROOT = cel("'sales_manager' in no_such_root.positions");

/**
 * The host scope `ExpressionProvider` mounts, transcribed (see #6010's pin).
 *
 * ⛔ No `data` since objectui#8166, and no `app` since objectui#8155 — this
 * literal claims to be that bag, so a root it carries that the producer does
 * not bind is a false claim that no assertion here would redden.
 */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, features: {} };
}

const DENIED = hostScope(['sales']);
const ALLOWED = hostScope(['sales_manager']);

function renderForm(schema: Record<string, unknown>, scope: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <PredicateScopeProvider scope={scope}>
      <Form schema={{ type: 'form', showSubmit: false, showCancel: false, ...schema }} />
    </PredicateScopeProvider>,
  );
}

/**
 * One un-gated field (the control that proves the form rendered at all), one
 * gated section claiming its two members. `'ghost'` in the claim pins
 * FormFieldTab parity: unknown claimed names are ignored, never a fault.
 */
const groupedFields = (gate: unknown, salaryExtra: Record<string, unknown> = {}) => [
  { name: 'title', label: 'Title', type: 'input' },
  {
    name: 'pay',
    label: 'Compensation',
    type: 'section-divider',
    visibleWhen: gate,
    fields: ['salary', 'bonus', 'ghost'],
  },
  { name: 'salary', label: 'Salary', type: 'input', ...salaryExtra },
  { name: 'bonus', label: 'Bonus', type: 'input' },
];

const heading = () => screen.queryByText('Compensation');
const member = (re: RegExp) => screen.queryByLabelText(re);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('#6236 — a claiming divider gates its whole group', () => {
  it('DENIED: the heading AND every claimed field are hidden (control stays)', () => {
    renderForm({ fields: groupedFields(GATE) }, DENIED);
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(heading()).toBeNull();
    expect(member(/salary/i)).toBeNull();
    expect(member(/bonus/i)).toBeNull();
  });

  it('ALLOWED: the SAME predicate text, a user it admits — heading and fields all render', () => {
    renderForm({ fields: groupedFields(GATE) }, ALLOWED);
    expect(heading()).not.toBeNull();
    expect(member(/salary/i)).not.toBeNull();
    expect(member(/bonus/i)).not.toBeNull();
  });

  it('FAULTED: a genuinely unbound root fails OPEN — the whole group renders', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderForm({ fields: groupedFields(UNBOUND_ROOT) }, DENIED);
    expect(heading()).not.toBeNull();
    expect(member(/salary/i)).not.toBeNull();
    expect(member(/bonus/i)).not.toBeNull();
  });

  it('a hidden section\'s values STILL SUBMIT — visibility decides what is drawn and nothing else', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: groupedFields(GATE),
        defaultValues: { salary: '120000' },
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      DENIED,
    );
    // The claimed field is genuinely not drawn — the value below cannot have
    // come from a rendered control.
    expect(member(/salary/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit.mock.calls[0][0] as Record<string, unknown>).salary).toBe('120000');
  });

  it('a REQUIRED field in a hidden section does not block the submit (client validation skipped)', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: groupedFields(GATE, { required: true }),
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      DENIED,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(document.body.textContent).not.toMatch(/required/i);
  });

  it('control: the SAME required field in a VISIBLE section still blocks the submit', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: groupedFields(GATE, { required: true }),
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      ALLOWED,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/required/i));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a section hiding mid-session clears its members\' stale errors and unblocks the submit', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: [
          { name: 'plan', label: 'Plan', type: 'input' },
          {
            name: 'pay',
            label: 'Compensation',
            type: 'section-divider',
            visibleWhen: cel("record.plan == 'standard'"),
            fields: ['salary'],
          },
          { name: 'salary', label: 'Salary', type: 'input', required: true },
        ],
        defaultValues: { plan: 'standard' },
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      ALLOWED,
    );
    // Section visible, required member empty → the submit is refused. This
    // also registers the member's validator, so the second half below proves
    // an already-registered rule is skipped once the section hides — the
    // stronger direction (a never-mounted member skips trivially).
    expect(member(/salary/i)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(document.body.textContent).toMatch(/required/i));
    expect(onSubmit).not.toHaveBeenCalled();
    // Flip the gating value → the section (and its member) leave the screen,
    // the stale required-error clears, and the submit goes through.
    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'exec' } });
    await waitFor(() => expect(member(/salary/i)).toBeNull());
    await waitFor(() => expect(document.body.textContent).not.toMatch(/required/i));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('compat: a divider WITHOUT a claim gates only the heading (pre-#6236 contract)', () => {
    renderForm(
      {
        fields: [
          { name: 'title', label: 'Title', type: 'input' },
          { name: 'pay', label: 'Compensation', type: 'section-divider', visibleWhen: GATE },
          { name: 'salary', label: 'Salary', type: 'input' },
        ],
      },
      DENIED,
    );
    expect(heading()).toBeNull();
    expect(member(/salary/i)).not.toBeNull();
  });
});
