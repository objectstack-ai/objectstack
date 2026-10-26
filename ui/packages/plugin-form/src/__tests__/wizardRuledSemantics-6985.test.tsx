/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6985 (Card R) — consumer-side pins for the RULED wizard v1
 * semantics (objectstack#13622 D2/D7/D8, maintainer ruling 2026-08-31; the
 * spec half landed as objectstack PR #13733).
 *
 * ## Why BEHAVIOUR pins are sanctioned now
 *
 * `sectionPredicateLayoutDiagnostic-6237.test.tsx` deliberately pins REPORTING
 * only — when it was written, the wizard step contract was interim and pinning
 * behaviour would have declared a contract by the back door. The 2026-08-31
 * ruling closed that: wizard steps carry no predicate slot (steps are entered
 * in array order behind the step gate, never conditionally), wizard steps do
 * not collapse, sections ARE the steps with array order as step order, and a
 * wizard with absent/empty `sections` is refused at the spec door. Those are
 * now the ruled semantics, so this file pins them as behaviour — from the
 * consumer side, where the failure mode would be WizardForm quietly HONOURING
 * a key the spec door refuses (a renderer dialect diverging from the
 * contract), or quietly changing what the refused shapes degrade into.
 *
 * ## What is deliberately NOT here
 *
 * - D4 (`allowSkip` = navigation freedom, not a validation exemption) is
 *   already pinned in `wizardSkipValidation.test.tsx` (#2959) — not re-pinned.
 * - The warn wording for the dropped predicate stays pinned in
 *   `sectionPredicateLayoutDiagnostic-6237.test.tsx` — not re-pinned.
 * - The compile-time step-key refusals stay pinned in
 *   `tabbedFormSectionPredicate-6237.test.tsx` (including the `*When` family
 *   pin) — this file covers the UNTYPED path those cannot see: JSON reaching
 *   `ObjectForm` from programmatic SDUI callers, which never pass the spec
 *   door and never see the compiler.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { PredicateScopeProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import { FormSectionContainer } from '../FormSection';

registerAllFields();

/** Canonical wire shape — same spelling the #6111 / #6237 pins use. */
const cel = (source: string) => ({ dialect: 'cel', source });
const GATE = cel("'sales_manager' in current_user.positions");

/** A principal the GATE denies — the state where honouring the predicate
 *  would REMOVE the step, i.e. where the drop is observable. */
function deniedScope() {
  const user = { id: 'u1', name: 'Kim', positions: ['sales'] };
  return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
}

const objectSchema = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    salary: { type: 'text', label: 'Salary' },
    notes: { type: 'text', label: 'Notes' },
  },
};

let dataSource: any;

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  // The predicate drop on the wizard route REPORTS (pinned elsewhere); keep
  // the console quiet here without asserting on it.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderWizard = async (
  sections: unknown,
  extra: Record<string, unknown> = {},
) => {
  const view = render(
    <PredicateScopeProvider scope={deniedScope() as any}>
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'crm_case',
          mode: 'create',
          formType: 'wizard',
          sections,
          ...extra,
        } as any}
        dataSource={dataSource}
      />
    </PredicateScopeProvider>,
  );
  return view;
};

/** The wizard's step indicator buttons, in DOM order. */
const indicatorSteps = () =>
  Array.from(document.querySelectorAll('[data-testid^="wizard-step:"]')).map(
    (el) => el.getAttribute('data-testid'),
  );

const progressNav = () => document.querySelector('nav[aria-label="Progress"]');

describe('#6985 D2 — a wizard-inert step key is DROPPED, never honoured', () => {
  it('a DENYING `visibleWhen` does not remove the step: it renders, first, unconditionally', async () => {
    // The gated step is FIRST, so "honouring" the denied predicate would have
    // to remove or skip the very step on screen — the observable direction.
    await renderWizard([
      { name: 'pay', label: 'Compensation', visibleWhen: GATE, fields: ['salary'] },
      { name: 'always', label: 'Always', fields: ['subject'] },
    ]);
    // The gated step's own field is drawn as the current step.
    await waitFor(() =>
      expect(document.querySelector('input[name="salary"]')).toBeTruthy(),
    );
    // And the step stays on the indicator — both declared steps do.
    expect(indicatorSteps()).toEqual(['wizard-step:pay', 'wizard-step:always']);
  });

  it('`collapsible`/`collapsed: true` produce NO collapse affordance on a step', async () => {
    await renderWizard([
      { name: 'only', label: 'Only', collapsible: true, collapsed: true, fields: ['subject'] },
    ]);
    // The step's field is drawn — an honoured `collapsed: true` would hide it.
    await waitFor(() =>
      expect(document.querySelector('input[name="subject"]')).toBeTruthy(),
    );
    // And no collapse trigger exists anywhere in the step chrome. The
    // affordance `FormSectionContainer` renders for a collapsible section is a
    // header with `role="button"` + `aria-expanded` (see the CONTROL below);
    // the wizard's step container must not have grown one.
    expect(document.querySelector('[aria-expanded]')).toBeNull();
  });

  it('CONTROL: the selector detects the affordance where a layout really honours it', () => {
    // Not decoration: if `FormSectionContainer` ever changed how a collapse
    // trigger is spelled in the DOM, the assertion above would pass vacuously.
    // This row proves the probe finds the affordance on the component that
    // renders it.
    render(
      <FormSectionContainer label="Collapsible" collapsible>
        <div />
      </FormSectionContainer>,
    );
    expect(document.querySelector('[role="button"][aria-expanded]')).toBeTruthy();
  });
});

describe('#6985 D7 — the empty-steps wizard degrades to a plain simple form (the shape the spec door now refuses)', () => {
  // `@objectstack/spec` refuses `type: 'wizard'` with absent/empty `sections`
  // at parse for authored form views (objectstack#13622 D7) — PRECISELY
  // because this renderer chain silently falls back to simple rendering.
  // These rows pin that measured fallback: it is what the door protects
  // authors from, and it is still the documented degradation for programmatic
  // SDUI callers, which do not pass the door. If the fallback ever changes
  // shape (e.g. starts throwing), that is a contract event, not a refactor.
  it('`sections: []` renders the simple form — no step machinery', async () => {
    await renderWizard([]);
    await waitFor(() =>
      expect(document.querySelector('input[name="subject"]')).toBeTruthy(),
    );
    expect(progressNav()).toBeNull();
    expect(indicatorSteps()).toEqual([]);
  });

  it('absent `sections` renders the simple form — same fallback', async () => {
    await renderWizard(undefined);
    await waitFor(() =>
      expect(document.querySelector('input[name="subject"]')).toBeTruthy(),
    );
    expect(progressNav()).toBeNull();
  });

  it('CONTROL: a ONE-step wizard is legal and renders AS a wizard — no "at least 2 steps" floor', async () => {
    // D7's ruled boundary, from the consumer side: the refusal is about
    // emptiness, never about arity. One declared step gets the full wizard
    // (indicator included, since `showStepIndicator` defaults to shown).
    await renderWizard([{ name: 'only', label: 'Only', fields: ['subject'] }]);
    await waitFor(() =>
      expect(document.querySelector('input[name="subject"]')).toBeTruthy(),
    );
    expect(progressNav()).toBeTruthy();
    expect(indicatorSteps()).toEqual(['wizard-step:only']);
  });
});

describe('#6985 D8 — array order IS step order', () => {
  const forward = [
    { name: 'a', label: 'Alpha', fields: ['subject'] },
    { name: 'b', label: 'Beta', fields: ['salary'] },
    { name: 'c', label: 'Gamma', fields: ['notes'] },
  ];

  it('the indicator lists steps in array order and step 1 is sections[0]', async () => {
    await renderWizard(forward);
    await waitFor(() =>
      expect(document.querySelector('input[name="subject"]')).toBeTruthy(),
    );
    expect(indicatorSteps()).toEqual(['wizard-step:a', 'wizard-step:b', 'wizard-step:c']);
    // Only sections[0]'s field is mounted — a wizard mounts one step at a time.
    expect(document.querySelector('input[name="salary"]')).toBeNull();
    expect(document.querySelector('input[name="notes"]')).toBeNull();
  });

  it('reversing the array reverses the wizard — order comes from the ARRAY, not names or labels', async () => {
    // The control that makes the row above a measurement: identical steps,
    // identical names and labels, one variable (array position) — and the
    // wizard follows it. An `order` key or name-based sorting would make this
    // row and the one above disagree.
    await renderWizard([...forward].reverse());
    await waitFor(() =>
      expect(document.querySelector('input[name="notes"]')).toBeTruthy(),
    );
    expect(indicatorSteps()).toEqual(['wizard-step:c', 'wizard-step:b', 'wizard-step:a']);
    expect(document.querySelector('input[name="subject"]')).toBeNull();
  });
});
