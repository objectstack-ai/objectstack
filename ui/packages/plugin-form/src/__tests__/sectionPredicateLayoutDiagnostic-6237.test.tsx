/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6237 — the ruled INTERIM diagnostic for an authored
 * `FormSection.visibleWhen` on a layout arm that cannot yet honour it.
 *
 * ## What was ruled, and what this file does and does not pin
 *
 * Maintainer ruling, 2026-08-29 (live director session batch #3), option A: the
 * full repair is a DESIGN task — one renderer-side section/group contract with a
 * predicate slot, designed once for every layout arm (tabbed / TabbedForm /
 * WizardForm / flat) rather than patched arm by arm. Ruled as part of that same
 * option: *"a loud diagnostic lands first — an authored section `visibleWhen` on
 * the tabbed arm reports 'not yet supported on this layout' instead of today's
 * silent inertness."*
 *
 * ⛔ So this file pins REPORTING, never behaviour. It must not grow an assertion
 * that a `tabbed` or `wizard` section actually hides — that is the design task's
 * deliverable, and pinning it here would declare the contract by the back door.
 *
 * ## Why the control rows are the load-bearing half
 *
 * A diagnostic that fires everywhere is as useless as one that fires nowhere, and
 * far more annoying. The measured split on `origin/main` is:
 *
 *   - `split` / `drawer` / `modal` — `ObjectForm` rebuilds each section key by key
 *     and each of those three maps COPIES `visibleWhen` (#6111), so the predicate
 *     reaches a renderer. Warning on them would be a false alarm about a working
 *     feature.
 *   - flat / `simple` — carries the predicate on the `section-divider`
 *     pseudo-field. Also works.
 *   - `tabbed` (`TabbedForm`) — WAS inert, and is no longer: the tabbed map now
 *     copies the predicate, `TabbedForm` puts it on the tab it synthesises, and
 *     the renderer evaluates it. It has MOVED to the honouring set below, which
 *     is the single most important edit this file has taken: a diagnostic that
 *     keeps warning about a feature that started working is a false alarm, and
 *     false alarms are how a real one stops being read.
 *   - `wizard` (`WizardForm`) — the same key-by-key rebuild, copying no
 *     predicate. The last inert arm, and inert BY DESIGN: a step predicate is a
 *     different contract, not a port of the tab one (see `WizardStepConfig`).
 *
 * The negative rows below therefore pin the boundary, not politeness: they are
 * what stops a later edit from turning this into a blanket warning, and what
 * would catch the tabbed arm regressing back into silence.
 *
 * ⚠️ Note the ModalForm `contentLayout: 'tabbed'` arm is NOT an inert arm and is
 * deliberately absent from the warned set — it gained a real predicate slot in
 * #6619 (`FormFieldTab.visibleWhen`) and honours the key. "Tabbed" names two
 * different things on this card; only `formType: 'tabbed'` is inert.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import { sectionPredicateUnsupportedWarning } from '../sectionPredicateDiagnostic';

registerAllFields();

/** Canonical wire shape — same spelling the #6111 / #6010 pins use. */
const cel = (source: string) => ({ dialect: 'cel', source });
const GATE = cel("'sales_manager' in current_user.positions");

function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
}
/**
 * DENIED on purpose: the predicate resolves FALSE, which is the only state in
 * which an author would notice the arm is inert. The diagnostic is deliberately
 * verdict-INDEPENDENT (it reports that nothing will evaluate the key at all), and
 * the ALLOWED row below pins exactly that.
 */
const DENIED = hostScope(['sales']);
const ALLOWED = hostScope(['sales_manager']);

const objectSchema = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    salary: { type: 'text', label: 'Salary' },
  },
};

let dataSource: any;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** `Always` is the un-gated control section; `Compensation` carries the gate. */
const sections = (gate: unknown = GATE) => [
  { name: 'always', label: 'Always', fields: ['subject'] },
  { name: 'pay', label: 'Compensation', visibleWhen: gate, fields: ['salary'] },
];

const renderObjectForm = async (
  scope: Record<string, unknown>,
  extra: Record<string, unknown>,
  sectionList: unknown = sections(),
) => {
  const view = render(
    <PredicateScopeProvider scope={scope as any}>
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'crm_case',
          mode: 'create',
          sections: sectionList,
          ...extra,
        } as any}
        dataSource={dataSource}
      />
    </PredicateScopeProvider>,
  );
  // The un-gated sibling is the readiness signal AND the proof the form mounted.
  await waitFor(() => expect(screen.getAllByText('Always').length).toBeGreaterThan(0));
  return view;
};

/** Only the #6237 diagnostic — other console.warn traffic is not this pin's subject. */
const diagnosticCalls = () =>
  warnSpy.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((m: string) => m.includes('Section `visibleWhen` is not yet supported on this layout'));

describe('#6237 — the ONE still-inert arm REPORTS instead of dropping the predicate in silence', () => {
  it('formType `wizard`: reports, naming the ruled phrase, the surface and the section', async () => {
    await renderObjectForm(DENIED, { formType: 'wizard' });
    await waitFor(() => expect(diagnosticCalls().length).toBe(1));
    const message = diagnosticCalls()[0];
    expect(message).toContain('not yet supported on this layout');
    expect(message).toContain("the `wizard` layout's steps");
    // The section is named, so an author with ten sections knows which one.
    expect(message).toContain('pay');
    expect(message).toContain('objectui#6237');
  });

  it("the remedy now names `tabbed` as a working arm — it stopped being the problem", async () => {
    // The remedy line is the half an author actually acts on. When an arm moves
    // from inert to honouring, a remedy that still omits it sends the author to
    // a layout they may not want for a reason that no longer exists.
    await renderObjectForm(DENIED, { formType: 'wizard' });
    await waitFor(() => expect(diagnosticCalls().length).toBe(1));
    expect(diagnosticCalls()[0]).toContain("`formType: 'tabbed' | 'modal' | 'drawer' | 'split'`");
  });

  it('the report does not depend on the VERDICT — an admitting predicate is just as inert', async () => {
    // Nothing evaluates the key on this arm, so a TRUE predicate is dropped
    // exactly as a FALSE one is. A diagnostic that only fired on the denied
    // scope would leave the author of an allow-rule believing it worked.
    await renderObjectForm(ALLOWED, { formType: 'wizard' });
    await waitFor(() => expect(diagnosticCalls().length).toBe(1));
  });

  it('every section carrying a predicate is named, not just the first', async () => {
    await renderObjectForm(DENIED, { formType: 'wizard' }, [
      { name: 'always', label: 'Always', fields: ['subject'] },
      { name: 'pay', label: 'Compensation', visibleWhen: GATE, fields: ['salary'] },
      { name: 'extra', label: 'Extra', visibleWhen: GATE, fields: ['subject'] },
    ]);
    await waitFor(() => expect(diagnosticCalls().length).toBe(1));
    expect(diagnosticCalls()[0]).toContain('pay, extra');
  });
});

describe('#6237 — the boundary: arms that HONOUR the predicate stay silent', () => {
  // Each row authors the identical predicate on the identical section. The only
  // variable is the layout, so a warning here would be a false alarm about a
  // feature #6111 / #6619 already landed.
  const honouring: Array<[string, Record<string, unknown>]> = [
    ['simple (flat, section-divider pseudo-field)', { formType: 'simple' }],
    ['modal (ObjectForm modal map copies it)', { formType: 'modal', open: true }],
    ['modal + contentLayout tabbed (#6619 FormFieldTab.visibleWhen)',
      { formType: 'modal', open: true, contentLayout: 'tabbed' }],
    ['drawer (ObjectForm drawer map copies it)', { formType: 'drawer', open: true }],
    ['split (ObjectForm split map copies it)', { formType: 'split' }],
    // The row this card moved. `tabbed` honours the key through the very same
    // renderer machinery the `modal + contentLayout: tabbed` row above uses —
    // `ObjectForm`'s tabbed map copies the predicate, `TabbedForm` copies it
    // onto the synthesised `FormFieldTab.visibleWhen`. Its BEHAVIOUR (not just
    // its silence) is pinned in tabbedFormSectionPredicate-6237.test.tsx.
    ['tabbed (TabbedForm, via FormFieldTab.visibleWhen)', { formType: 'tabbed' }],
  ];

  for (const [label, extra] of honouring) {
    it(`${label}: silent`, async () => {
      await renderObjectForm(DENIED, extra);
      expect(diagnosticCalls()).toEqual([]);
    });
  }

  it('an inert arm with NO authored predicate is silent — the gap, not the layout, is reported', async () => {
    await renderObjectForm(DENIED, { formType: 'wizard' }, [
      { name: 'always', label: 'Always', fields: ['subject'] },
      { name: 'pay', label: 'Compensation', fields: ['salary'] },
    ]);
    expect(diagnosticCalls()).toEqual([]);
  });
});

describe('#6237 — the report is once per mount, not once per render', () => {
  it('re-rendering the same schema does not re-report', async () => {
    const view = await renderObjectForm(DENIED, { formType: 'wizard' });
    await waitFor(() => expect(diagnosticCalls().length).toBe(1));
    // A fresh element with the same authored content: the effect's deps are
    // primitives (layout + joined names), so identity churn must not re-fire it.
    // Authoring a form re-renders on every keystroke; a per-render warning would
    // bury the console it is trying to speak into.
    view.rerender(
      <PredicateScopeProvider scope={DENIED as any}>
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'crm_case',
            mode: 'create',
            sections: sections(),
            formType: 'wizard',
          } as any}
          dataSource={dataSource}
        />
      </PredicateScopeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText('Always').length).toBeGreaterThan(0));
    expect(diagnosticCalls().length).toBe(1);
  });
});

describe('#6237 — the master-detail branch reports through its INNER pass, exactly once', () => {
  // `ObjectForm` routes a subforms-bearing schema to `MasterDetailForm` FIRST,
  // and that component builds a parent schema which re-enters `ObjectForm`. The
  // real layout is decided on that inner pass — a master-detail `wizard` parent
  // is rendered `simple`, which HONOURS the predicate. Reporting at the outer
  // call as well would double-report the tabbed parent and, worse, false-report
  // the wizard one about a layout it never actually renders.
  const subforms = [{ childObject: 'crm_case_line', relationshipField: 'case' }];

  it('master-detail `wizard`: silent — the parent renders `simple`, which honours the key', async () => {
    await renderObjectForm(DENIED, { formType: 'wizard', subforms });
    expect(diagnosticCalls()).toEqual([]);
  });

  it('master-detail `tabbed`: silent — the parent re-enters the honouring tabbed arm', async () => {
    // This row USED to be the "reported exactly once" case. It is silent now,
    // and the path is worth naming: `MasterDetailForm` passes the authored
    // sections through untouched and re-enters `ObjectForm` with
    // `formType: 'tabbed'`, so the predicate rides the same map every other
    // tabbed form uses. Master-detail needed no work of its own.
    await renderObjectForm(DENIED, { formType: 'tabbed', subforms });
    expect(diagnosticCalls()).toEqual([]);
  });
});

describe('#6237 — the message is single-sourced, and its remedy stays true', () => {
  it('the builder names the wizard surface and the sections it was given', () => {
    const message = sectionPredicateUnsupportedWarning('wizard', 'pay');
    expect(message).toContain('not yet supported on this layout');
    expect(message).toContain("the `wizard` layout's steps");
    expect(message).toContain('pay');
  });

  it('⛔ the remedy must never point at an arm that does not honour the key', () => {
    // The failure this pins is asymmetric and quiet: the message is prose, so a
    // layout that regressed (or one added later without a predicate slot) can
    // sit in the remedy list for months while every author it advises is sent
    // somewhere the key does nothing. The honouring rows above test the arms;
    // this tests the SENTENCE that recommends them.
    const message = sectionPredicateUnsupportedWarning('wizard', 'pay');
    for (const honoured of ['tabbed', 'modal', 'drawer', 'split']) {
      expect(message).toContain(honoured);
    }
    // ...and never recommends the arm it is complaining about.
    expect(message).not.toContain("'wizard' |");
  });
});
