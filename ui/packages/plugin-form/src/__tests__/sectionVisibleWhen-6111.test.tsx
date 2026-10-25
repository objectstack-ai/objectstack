/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6111 — an authored `FormSection.visibleWhen` must REACH an evaluator
 * on the object-view chain, in every plugin-form layout.
 *
 * `@objectstack/spec` declares `FormSection.visibleWhen`; this repo's spec
 * bridge carries it (`packages/react/src/spec-bridge/bridges/form-view.ts:250`);
 * `RecordFormPage` / `resolveFormViewLayout` wire whole `sections` objects into
 * the layouts. Every layout then renders a section header as a virtual
 * `section-divider` pseudo-field — and none of them copied the predicate onto
 * it, so the key was declared, mapped, carried, and dropped one hop before
 * anything evaluated it.
 *
 * The renderer half already works: `packages/components/src/renderers/form/
 * form.tsx` runs EVERY pseudo-field through `resolveFieldRuleState` with the
 * host predicate scope bound (#6010) before it reaches the `section-divider`
 * branch, so a divider carrying a `visibleWhen` hides exactly like a field
 * does. `predicate-scope-parity-6010.test.tsx`'s `sectionSurface` row pins that
 * directly, hand-authoring the pseudo-field this file makes the layouts emit.
 *
 * ## ⚠️ Why every case below asserts HIDDEN, and never merely SHOWN
 *
 * `visibleWhen` fails OPEN. A section that renders is the outcome of three
 * different worlds — the predicate resolved TRUE, the predicate never arrived,
 * and the predicate faulted — so **an assertion that a section IS shown
 * distinguishes none of them** and is green on unfixed code. The deliverable is
 * therefore the DENIED row: the heading is ABSENT while a predicate that
 * resolves false is authored on the section.
 *
 * The ALLOWED row is the control and nothing more. Without it, "hidden" is
 * satisfiable by a layout that dropped the heading for some unrelated reason
 * (an empty section, a bad label lookup), which would be a worse defect and
 * completely invisible to the DENIED row alone.
 *
 * ## Why one parameterised case would NOT have been enough
 *
 * There are SIX `section-divider` synthesis sites across FOUR layout files, and
 * a fix applied to five of six still passes a suite that exercises five. Each
 * layout is therefore mounted BY NAME below, through the entry the product
 * actually uses.
 *
 * Two hops had to be repaired per layout, and only the second was on the card:
 *
 *   1. `ObjectForm` rebuilds each section KEY BY KEY when it delegates to
 *      Split/Drawer/Modal (`ObjectForm.tsx` ~296/~331/~388) — a key that map
 *      does not copy never reaches the layout at all. `ModalForm`'s own
 *      `groups` map does the same thing again. The file's own comment on the
 *      split map already recorded the hazard: *"this mapping rebuilds each
 *      section key by key, so a key it doesn't copy is silently dropped —
 *      exactly how `visibleOn` once vanished here."*
 *   2. The `section-divider` synthesis sites themselves.
 *
 * Routing the modal/drawer/split rows through `ObjectForm` (which is what
 * `RecordFormPage` does) exercises BOTH hops; the direct `ModalForm` row covers
 * `resolveFormViewLayout`, which mounts `ModalForm` without passing through
 * `ObjectForm` at all.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Revert the `visibleWhen:` copy at any ONE synthesis site and that layout's
 * DENIED row — and only that one — goes red in the SHOWN direction (the heading
 * comes back), because the fallback is fail-open. Every ALLOWED row stays green
 * everywhere, which is precisely why the ALLOWED rows could never have caught
 * this.
 *
 * ## Scope — the whole group, since objectui#6236
 *
 * objectui#6236 (maintainer ruling 2026-08-27) closed the divergence this
 * header used to record: the renderer now holds a real divider-to-field
 * association — the divider's membership claim (`FormField.fields`, stamped by
 * every synthesis site above from the RESOLVED member list) — and a false
 * section predicate hides the heading AND the claimed fields, matching the
 * console renderer. So every DENIED row below asserts both halves: the heading
 * (the #6111 deliverable) and the gated member field (the #6236 wiring). The
 * hidden members skip client-side validation and their values still submit;
 * those semantics are pinned at the renderer in
 * `packages/components/src/renderers/form/__tests__/section-grouping-6236.test.tsx`
 * — this file pins that each LAYOUT's synthesis site actually stamps the claim
 * (an unstamped site reverts to heading-only, invisible to every other suite).
 *
 * Two derived-fieldGroup synthesis sites (ModalForm / DrawerForm
 * `derivedSections`) also stamp the claim for uniformity, but the spec
 * `fieldGroups` vocabulary has no section-predicate slot, so no authoring path
 * can turn their gate on today and no DENIED row can discriminate them; they
 * stay fail-open until that vocabulary grows a predicate.
 *
 * ## The tabbed modal arm — the seventh synthesis site (objectui#6237)
 *
 * `ModalForm` with `contentLayout: 'tabbed'` synthesises NO divider at all —
 * sections become `fieldTabs` entries — so its stamp is the tab's own
 * predicate slot (`FormFieldTab.visibleWhen`, same ruling as #6236) and its
 * DENIED row asserts the tab TRIGGER text and the member field are both gone.
 * The hidden-tab semantics (values still submit, client validation skipped,
 * re-selection, no mid-interaction collapse) are pinned at the renderer in
 * `packages/components/src/renderers/form/__tests__/fieldtab-visiblewhen-6237.test.tsx`;
 * the rows here pin only that THIS synthesis site copies the predicate onto
 * the tab.
 *
 * ## `TabbedForm` — the eighth synthesis site (objectui#6237, this card)
 *
 * `formType: 'tabbed'` reaches `TabbedForm`, which already synthesised
 * `fieldTabs` — the very machinery the modal tabbed arm above runs on — but
 * dropped the predicate at three points: `ObjectForm`'s tabbed map, the section
 * config (which declared no such key), and the `fieldTabs` synthesis. All three
 * now carry it, so this arm reaches the SAME evaluator by the SAME route and
 * gets a row in the matrix below rather than a mechanism of its own.
 *
 * ⛔ `WizardForm` is deliberately still absent, and not by oversight: its step
 * type OMITS the predicate (`WizardStepConfig`) because a step predicate is a
 * different contract — step-boundary reactive against the ruled live-record
 * reactivity, needing navigation and final-gate semantics none of this
 * machinery supplies. `ObjectForm` reports that gap at runtime instead
 * (sectionPredicateLayoutDiagnostic-6237.test.tsx). Adding a wizard row here
 * would be pinning an unruled contract into existence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import { ModalForm } from '../ModalForm';

registerAllFields();

/**
 * The canonical wire shape — `@objectstack/spec` normalizes an authored
 * predicate into a `{ dialect: 'cel' }` envelope at parse (ADR-0089 D2), and a
 * bare string would route to a different engine on some surfaces (measured in
 * `predicate-scope-parity-6010.test.tsx`). Same spelling as that file, on
 * purpose: one authored text, one verdict, every surface.
 */
const cel = (source: string) => ({ dialect: 'cel', source });

/** THE authored section predicate. One text, asked of every layout below. */
const GATE = cel("'sales_manager' in current_user.positions");

/** The host scope `ExpressionProvider` mounts, transcribed (see #6010's pin). */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
}

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

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Two sections: `Always` carries no predicate and is the paired control that
 * proves the form rendered AT ALL — so a missing `Compensation` heading is a
 * verdict and not an inability. `Compensation` carries the gate.
 */
const sections = (gate: unknown = GATE) => [
  { name: 'always', label: 'Always', fields: ['subject'] },
  { name: 'pay', label: 'Compensation', visibleWhen: gate, fields: ['salary'] },
];

/** Mount through `ObjectForm` — the entry `RecordFormPage` itself uses. */
const renderObjectForm = async (
  scope: Record<string, unknown>,
  extra: Record<string, unknown>,
  gate?: unknown,
) => {
  render(
    <PredicateScopeProvider scope={scope as any}>
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'crm_case',
          mode: 'create',
          sections: sections(gate),
          ...extra,
        } as any}
        dataSource={dataSource}
      />
    </PredicateScopeProvider>,
  );
  // The un-gated sibling heading is the readiness signal AND the control.
  await waitFor(() => expect(screen.getByText('Always')).toBeTruthy());
};

/** Mount `ModalForm` directly — the shape `resolveFormViewLayout` produces. */
const renderModalFormDirect = async (
  scope: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  gate?: unknown,
) => {
  render(
    <PredicateScopeProvider scope={scope as any}>
      <ModalForm
        schema={{
          type: 'modal-form',
          objectName: 'crm_case',
          mode: 'create',
          open: true,
          sections: sections(gate),
          ...extra,
        } as any}
        dataSource={dataSource}
      />
    </PredicateScopeProvider>,
  );
  await waitFor(() => expect(screen.getByText('Always')).toBeTruthy());
};

/** The gated section's heading — `null` when the layout hid it. */
const gatedHeading = () => screen.queryByText('Compensation');

/**
 * The gated section's claimed MEMBER field (#6236) — `null` when the layout's
 * synthesis site stamped the membership claim and the gate took the group.
 */
const gatedField = () => screen.queryByLabelText(/salary/i);

/**
 * Every layout, by name, with the mount that reaches its own synthesis site.
 * Named individually because a fix applied to five of six sites still passes a
 * suite that exercises five.
 */
const LAYOUTS: {
  label: string;
  mount: (scope: Record<string, unknown>, gate?: unknown) => Promise<void>;
}[] = [
  {
    label: 'ObjectForm — stacked `simple` sections (ObjectForm.tsx section-divider)',
    mount: (scope, gate) => renderObjectForm(scope, { formType: 'simple' }, gate),
  },
  {
    label: 'ModalForm — via ObjectForm delegation (key-by-key remap + ModalForm groups map)',
    mount: (scope, gate) => renderObjectForm(scope, { formType: 'modal', open: true }, gate),
  },
  {
    label: 'ModalForm — mounted directly (the resolveFormViewLayout shape)',
    mount: (scope, gate) => renderModalFormDirect(scope, {}, gate),
  },
  {
    // The tabbed arm (#6237): sections render as TAB PANELS, so there is no
    // divider to stamp — the synthesis site copies the predicate onto the
    // tab itself (`FormFieldTab.visibleWhen`) and the renderer hides trigger,
    // panel and members together. In the DENIED row `gatedHeading()` is the
    // tab TRIGGER text rather than a divider heading — same locator, same
    // authored key, seventh synthesis site.
    label: "ModalForm — contentLayout 'tabbed', mounted directly (fieldTabs synthesis, #6237)",
    mount: (scope, gate) => renderModalFormDirect(scope, { contentLayout: 'tabbed' }, gate),
  },
  {
    // Same arm via ObjectForm delegation: `contentLayout` rides the spread and
    // the key-by-key section remap must have copied `visibleWhen` for the tab
    // to receive it — both hops, like the stacked modal row above.
    label: "ModalForm — contentLayout 'tabbed', via ObjectForm delegation (#6237)",
    mount: (scope, gate) =>
      renderObjectForm(scope, { formType: 'modal', open: true, contentLayout: 'tabbed' }, gate),
  },
  {
    // The `formType: 'tabbed'` arm (#6237, this card). Same shape as the two
    // modal-tabbed rows above — sections become tab panels, so the stamp is the
    // tab's own `FormFieldTab.visibleWhen` and `gatedHeading()` reads the tab
    // TRIGGER text — but a DIFFERENT chain: `ObjectForm`'s tabbed map into
    // `TabbedForm`'s own `fieldTabs` synthesis. Both hops must copy the key, and
    // a row per chain is the point of this matrix: the modal rows stayed green
    // through the entire period this arm was inert.
    label: "TabbedForm — formType 'tabbed', via ObjectForm delegation (tabbed map + fieldTabs synthesis, #6237)",
    mount: (scope, gate) => renderObjectForm(scope, { formType: 'tabbed' }, gate),
  },
  {
    label: 'DrawerForm — via ObjectForm delegation (key-by-key remap + explicit-sections divider)',
    mount: (scope, gate) => renderObjectForm(scope, { formType: 'drawer', open: true }, gate),
  },
  {
    label: 'SplitForm — via ObjectForm delegation (key-by-key remap + paneFields divider)',
    mount: (scope, gate) => renderObjectForm(scope, { formType: 'split' }, gate),
  },
];

describe('#6111 — an authored section `visibleWhen` reaches an evaluator in every layout', () => {
  describe('DENIED — the predicate resolves FALSE, so the whole section is HIDDEN', () => {
    // ⚠️ THE deliverable, in two halves. The heading half (#6111) separates
    // "the predicate arrived and was evaluated" from "it never arrived"; the
    // member half (#6236) separates "this layout's synthesis site stamped the
    // membership claim" from "the divider arrived claim-less and the gate
    // stayed heading-only" — an unstamped site fails ONLY here, in the SHOWN
    // direction, because a claim-less divider is valid compat behaviour
    // everywhere else.
    for (const layout of LAYOUTS) {
      it(layout.label, async () => {
        await layout.mount(DENIED);
        expect(gatedHeading()).toBeNull();
        expect(gatedField()).toBeNull();
      });
    }
  });

  describe('ALLOWED — the SAME predicate text, a user it admits ⇒ still SHOWN', () => {
    // The control. Without it, "hidden" is satisfied by a layout that dropped
    // the heading for an unrelated reason — a worse defect, invisible above.
    // The member assertion keeps the same honesty for the group half: a gate
    // that hides claimed fields unconditionally would pass every DENIED row.
    for (const layout of LAYOUTS) {
      it(layout.label, async () => {
        await layout.mount(ALLOWED);
        expect(gatedHeading()).not.toBeNull();
        expect(gatedField()).not.toBeNull();
      });
    }
  });

  describe('FAULTED — a genuinely unbound root still fails OPEN (unchanged)', () => {
    // Pinned so the DENIED rows above mean "evaluated and false" rather than
    // "could not be evaluated at all". Asserted against the DENIED user on
    // purpose: the only difference from the DENIED block is the ROOT the
    // predicate names, so a fail-CLOSED regression cannot hide behind the
    // membership test.
    //
    // Mounted through `layout.mount` like the two blocks above (#6237's edit):
    // the loop used to render the SAME simple form under every row's label, so
    // five FAULTED rows named layouts they never mounted — fail-open was only
    // ever measured on the stacked path.
    for (const layout of LAYOUTS) {
      it(layout.label, async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const unbound = cel("'sales_manager' in no_such_root.positions");
        await layout.mount(DENIED, unbound);
        expect(gatedHeading()).not.toBeNull();
        expect(gatedField()).not.toBeNull();
      });
    }
  });

  it('measured scope: a hidden section hides its FIELDS too (objectui#6236 wiring landed)', async () => {
    // FLIPPED — deliberately, and exactly once. From #6111 until the #6236
    // wiring landed, this case pinned the honest limitation: the divider was a
    // presentational row, so a false section predicate removed the heading and
    // LEFT THE FIELDS RENDERING (`expect(getByLabelText(/salary/i)).toBeTruthy()`
    // stood here). #6111 wrote it so that its red flip would be the SIGNAL the
    // grouping contract landed rather than a broken test — and that is what
    // happened: the synthesis sites now stamp the membership claim
    // (`fields: [...names]`) onto the divider, the renderer gates the whole
    // group, and this case now pins the NEW contract on the same chain, the
    // same mount, the same predicate: heading gone AND claimed field gone,
    // matching the console renderer at last. Values still submit and hidden
    // members skip client-side validation — pinned at the renderer in
    // section-grouping-6236.test.tsx.
    await renderObjectForm(DENIED, { formType: 'simple' });
    expect(gatedHeading()).toBeNull();
    expect(gatedField()).toBeNull();
  });
});
