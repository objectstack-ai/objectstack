/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6237 — the `formType: 'tabbed'` arm of the ONE grouping contract,
 * and the three semantics the 2026-08-29 ruling made binding.
 *
 * ## What this file is for, and what it deliberately is not
 *
 * `sectionVisibleWhen-6111.test.tsx` pins that this arm's synthesis chain
 * COPIES the predicate (its DENIED/ALLOWED/FAULTED triad). This file pins the
 * three ruled SEMANTICS as they are observable from the authored surface — the
 * questions the ruling said the design must answer before implementation:
 *
 *   1. Hidden tab x required fields — neither silent submit-blocking (which
 *      re-opens the objectui#2959 regression) nor a bypass the server then 400s.
 *   2. What happens when the ACTIVE tab hides itself.
 *   3. Collapse below two tabs.
 *
 * ⭐ Semantics 1 to 3 were SETTLED BEFORE this card's implementation, and the
 * rows below are inheritance receipts, not new decisions:
 *
 *   - The behaviour was ruled on 2026-08-27 (visibility gates DRAWING only;
 *     hidden-group values still submit; hidden-group fields skip CLIENT-side
 *     validation with the server as the loud floor) and implemented in the form
 *     renderer for `fieldTabs` by PR #6619.
 *   - `TabbedForm` already synthesised `fieldTabs`. So this arm inherits all
 *     three through the identical code path the modal tabbed arm uses; nothing
 *     was re-implemented beside it.
 *
 * That is exactly why these rows are worth their cost. Inheritance is a claim
 * about a code path, and a later edit that gives this layout its own predicate
 * handling — a plausible "cleanup" — would satisfy every row in the #6111
 * matrix (the key still arrives) while quietly diverging on all three
 * semantics. These rows fail when the arms stop agreeing.
 *
 * ## The one semantic this card actually DECIDED: sub-two-tab degradation
 *
 * Semantic 3 wears one name over two situations. The renderer answered the one
 * everybody meant — a predicate hiding one of two tabs does not collapse the
 * strip, because engagement is judged on DECLARED tabs. It does not answer the
 * other: a form declaring a SINGLE section never engages the tab arm at all
 * (the renderer needs more than one usable tab), so before this card there was
 * no tab to carry the predicate and the key was inert in that one shape.
 *
 * Left alone, this card would have made things WORSE there: `ObjectForm` stops
 * reporting the tabbed gap (the arm supports the key now), so the single-section
 * case would have gone from loudly-inert to silently-inert. The defined
 * degradation is the untabbed layout's OWN mechanism (#6236) — a chrome-less
 * `section-divider` claiming its members by name, which reaches the same
 * unmount path and therefore the same ruled semantics.
 *
 * ## The boundary that is enforced by TYPE, not by prose
 *
 * The wizard borrows this layout's section shape but cannot honour a predicate
 * (see `WizardStepConfig`). The last block pins that the key is a compile error
 * on a wizard step — the enforcement half of "declared equals enforced".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import type { FormSectionConfig } from '../TabbedForm';
import type { WizardStepConfig } from '../WizardForm';

registerAllFields();

/** Canonical wire shape — same spelling as the #6111 / #6010 pins. */
const cel = (source: string) => ({ dialect: 'cel', source });
const GATE = cel("'sales_manager' in current_user.positions");

function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
}
const DENIED = hostScope(['sales']);
const ALLOWED = hostScope(['sales_manager']);

/**
 * `salary` is REQUIRED on the object — the whole point of semantic 1. A form
 * that blocks on it while its tab is hidden re-opens #2959 through the new door.
 */
const objectSchema = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    salary: { type: 'text', label: 'Salary', required: true },
    notes: { type: 'text', label: 'Notes' },
  },
};

let dataSource: any;

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'case-1' }),
    update: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const twoSections = (gate: unknown = GATE) => [
  { name: 'basics', label: 'Basics', fields: ['subject'] },
  { name: 'pay', label: 'Compensation', visibleWhen: gate, fields: ['salary'] },
];

const renderTabbed = async (
  scope: Record<string, unknown>,
  sections: unknown,
  extra: Record<string, unknown> = {},
) => {
  const view = render(
    <PredicateScopeProvider scope={scope as any}>
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'crm_case',
          mode: 'create',
          formType: 'tabbed',
          sections,
          ...extra,
        } as any}
        dataSource={dataSource}
      />
    </PredicateScopeProvider>,
  );
  // The un-gated sibling is the readiness signal AND the proof the form mounted,
  // so a missing gated tab is a VERDICT rather than an inability.
  await waitFor(() => expect(screen.getAllByText('Basics').length).toBeGreaterThan(0));
  return view;
};

const trigger = (key: string) => screen.queryByTestId(`form-tab:${key}`);
const panel = (key: string) => screen.queryByTestId(`form-tab-panel:${key}`);
const salaryInput = () => screen.queryByLabelText(/salary/i);
const submit = () => screen.getByRole('button', { name: /create/i });

describe('#6237 semantic 1 — a hidden tab x required fields', () => {
  it('DENIED: the required field on the hidden tab does NOT block the submit', async () => {
    // The ruled resolution, and the reason it is not a bypass invented here:
    // the panel is not drawn, so its Controller unmounts and react-hook-form
    // skips an unmounted field's rules. Same mechanism a field's own false
    // predicate uses — inherited, not re-implemented.
    await renderTabbed(DENIED, twoSections());
    expect(trigger('pay')).toBeNull();
    expect(salaryInput()).toBeNull();
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'S1' } });
    fireEvent.click(submit());
    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
  });

  it('CONTROL: the SAME required field on a VISIBLE (merely inactive) tab still blocks', async () => {
    // Without this row, "does not block" is satisfied by a form that stopped
    // validating altogether — which is the far worse defect and is invisible
    // above. #2959's contract is that an inactive tab keeps BOTH its values and
    // its validation; only a PREDICATE-hidden tab sheds the rules.
    await renderTabbed(ALLOWED, twoSections());
    expect(trigger('pay')).not.toBeNull();
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'S1' } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0));
    expect(dataSource.create).not.toHaveBeenCalled();
  });

  it('DENIED: the hidden tab\'s VALUE still submits — visibility gates drawing and nothing else', async () => {
    // The other half of the ruled semantics, and the half that makes the
    // skipped validation coherent rather than a data hole: a value seeded from
    // the record (or a default) is kept by react-hook-form and reaches the
    // payload even though nothing drew it.
    await renderTabbed(DENIED, twoSections(), { initialValues: { salary: '120000' } });
    expect(salaryInput()).toBeNull();
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'S1' } });
    fireEvent.click(submit());
    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    const payload = dataSource.create.mock.calls[0].find(
      (a: unknown) => a && typeof a === 'object' && 'salary' in (a as object),
    ) as Record<string, unknown> | undefined;
    expect(payload?.salary).toBe('120000');
  });
});

describe('#6237 semantic 2 — the ACTIVE tab hides itself', () => {
  it('a form whose FIRST tab is hidden activates a visible one — never an empty panel', async () => {
    // `activeFieldTab` derives over the VISIBLE tabs, so the tab that would
    // have been picked by default simply stops winning. The failure this
    // forecloses is a selection pointing at a tab that is no longer drawn,
    // which renders a form with a strip and nothing under it.
    await renderTabbed(DENIED, [
      { name: 'pay', label: 'Compensation', visibleWhen: GATE, fields: ['salary'] },
      { name: 'basics', label: 'Basics', fields: ['subject'] },
      { name: 'more', label: 'More', fields: ['notes'] },
    ]);
    expect(trigger('pay')).toBeNull();
    await waitFor(() =>
      expect(panel('basics')).toHaveAttribute('data-state', 'active'),
    );
    expect(salaryInput()).toBeNull();
  });

  it('the DECLARED default is honoured when it survives, and skipped when it does not', async () => {
    // Re-selection is an ordered fallback (pick, then declared default, then
    // first visible), not "always the first tab". A default pointing at a
    // hidden tab must degrade rather than win and blank the form.
    await renderTabbed(DENIED, [
      { name: 'basics', label: 'Basics', fields: ['subject'] },
      { name: 'pay', label: 'Compensation', visibleWhen: GATE, fields: ['salary'] },
      { name: 'more', label: 'More', fields: ['notes'] },
    ], { defaultTab: 'pay' });
    expect(trigger('pay')).toBeNull();
    await waitFor(() =>
      expect(panel('basics')).toHaveAttribute('data-state', 'active'),
    );
  });
});

describe('#6237 semantic 3a — a predicate does NOT collapse the arm', () => {
  it('one of two tabs hidden: the strip survives with a single trigger', async () => {
    // Engagement is structural, judged on DECLARED tabs. A collapse into the
    // untabbed layout mid-interaction would remount every surviving field —
    // destroying focus and in-progress edits — and would draw the hidden tab's
    // fields flat, breaking the ruled semantics in the same stroke.
    await renderTabbed(DENIED, twoSections());
    expect(trigger('basics')).not.toBeNull();
    expect(trigger('pay')).toBeNull();
    expect(panel('basics')).not.toBeNull();
  });

  it('ALLOWED: the same two declared tabs, both drawn', async () => {
    await renderTabbed(ALLOWED, twoSections());
    expect(trigger('basics')).not.toBeNull();
    expect(trigger('pay')).not.toBeNull();
  });
});

describe('#6237 semantic 3b — degradation BELOW two declared tabs', () => {
  // The situation the renderer does not answer, and the only one this card
  // decided rather than inherited. A single-section `tabbed` form is already
  // rendered as the untabbed layout, so the defined degradation is the untabbed
  // layout's own predicate mechanism.
  const oneSection = (gate: unknown = GATE) => [
    { name: 'pay', label: 'Compensation', visibleWhen: gate, fields: ['salary'] },
  ];

  it('DENIED: a single-section tabbed form still honours the predicate', async () => {
    render(
      <PredicateScopeProvider scope={DENIED as any}>
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'crm_case',
            mode: 'create',
            formType: 'tabbed',
            sections: oneSection(),
          } as any}
          dataSource={dataSource}
        />
      </PredicateScopeProvider>,
    );
    // No un-gated sibling exists here, so readiness is the submit control.
    await waitFor(() => expect(screen.getByRole('button', { name: /create/i })).toBeTruthy());
    expect(salaryInput()).toBeNull();
  });

  it('ALLOWED: the same single section renders — the gate is a verdict, not a swallow', async () => {
    render(
      <PredicateScopeProvider scope={ALLOWED as any}>
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'crm_case',
            mode: 'create',
            formType: 'tabbed',
            sections: oneSection(),
          } as any}
          dataSource={dataSource}
        />
      </PredicateScopeProvider>,
    );
    await waitFor(() => expect(salaryInput()).not.toBeNull());
  });

  it('a single section with NO predicate is untouched — no heading appears', async () => {
    // The degradation gate is chrome-less and emitted only for a section that
    // authored a predicate, so an existing single-section tabbed form renders
    // exactly as it did. A visible heading here would be a layout regression
    // shipped to every such form under the banner of a predicate fix.
    render(
      <PredicateScopeProvider scope={DENIED as any}>
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'crm_case',
            mode: 'create',
            formType: 'tabbed',
            sections: [{ name: 'pay', label: 'Compensation', fields: ['salary'] }],
          } as any}
          dataSource={dataSource}
        />
      </PredicateScopeProvider>,
    );
    await waitFor(() => expect(salaryInput()).not.toBeNull());
    expect(screen.queryByText('Compensation')).toBeNull();
  });
});

describe('#6237 — the wizard boundary is enforced by the TYPE, not by a comment', () => {
  it('the tabbed arm\'s section config ACCEPTS the predicate', () => {
    const section: FormSectionConfig = {
      name: 'pay',
      label: 'Compensation',
      fields: ['salary'],
      visibleWhen: GATE,
    };
    expect(section.visibleWhen).toBe(GATE);
  });

  it('⛔ a wizard STEP rejects it at compile time — the enforcement half', () => {
    // This is the pin, and it is a TYPE assertion: `tsc -p tsconfig.test.json`
    // runs over this file, so the `@ts-expect-error` below FAILS THE BUILD if
    // the key ever becomes writable on a wizard step. Declaring a key the
    // wizard renderer does not read is precisely the declared-but-unenforced
    // shape this card family exists to close, and prose cannot prevent it.
    const step: WizardStepConfig = {
      name: 'pay',
      label: 'Compensation',
      fields: ['salary'],
      // @ts-expect-error a wizard step has no predicate slot (objectui#6237)
      visibleWhen: GATE,
    };
    expect(step.name).toBe('pay');
  });

  it('⛔ NO predicate-family key may appear on a wizard step — the family pin', () => {
    // The pin above names ONE key. That was the whole weakness of the shape
    // this replaced: `WizardStepConfig` was `Omit<FormSectionConfig,
    // 'visibleWhen'>`, so it defended `visibleWhen` and let every FUTURE key
    // added to the tabbed section type reach a wizard step by default — the
    // same SILENT slot the 2026-08-30 ruling split the types to stop, one key
    // later. `readonlyWhen` and `requiredWhen` are already this repo's
    // field-level predicate vocabulary (see the plugin-form README's rule
    // table), so the next key in the family is a named possibility, not a
    // hypothetical.
    //
    // These are TYPE assertions: they are erased at runtime, so vitest proves
    // nothing about them and `tsc -p tsconfig.test.json` is the only thing that
    // can. `Expect` fails its own constraint when the argument is not `true`.
    type Expect<T extends true> = T;
    // `-?` strips optionality, or a mapped type over optional keys yields
    // `K | undefined` and the `never` comparison below could never be true.
    type PredicateKeysOf<T> = {
      [K in keyof T]-?: K extends `${string}When` ? K : never;
    }[keyof T];

    // ⭐ The CONTROL, and it is not decoration: a `PredicateKeysOf` that
    // silently resolved to `never` for everything would make the wizard row
    // below pass vacuously — a phantom check that can never fail. This row
    // proves the machinery detects a predicate key when one is really there,
    // on the sibling type that really has one.
    //
    // ⚠️ The DIRECTION is the whole control. Written the other way round
    // (`PredicateKeysOf<FormSectionConfig> extends 'visibleWhen'`) it would be
    // vacuous for exactly the failure it is meant to catch: `never` is
    // assignable to everything, so a broken helper returning `never` would
    // satisfy it too — and then BOTH rows would pass while measuring nothing.
    // Asking whether `'visibleWhen'` is assignable TO the helper's result is
    // the assertion a `never` result fails.
    type _TabbedSectionHasThePredicateKey = Expect<
      'visibleWhen' extends PredicateKeysOf<FormSectionConfig> ? true : false
    >;

    // The pin itself: the wizard's step type carries no `*When` key at all.
    type _WizardStepHasNoPredicateKey = Expect<
      PredicateKeysOf<WizardStepConfig> extends never ? true : false
    >;

    // Keep both aliases used, so `noUnusedLocals` cannot delete the pin.
    const pinned: [_TabbedSectionHasThePredicateKey, _WizardStepHasNoPredicateKey] = [true, true];
    expect(pinned).toEqual([true, true]);
  });
});
