/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#13626 — the form-view section style keys are NOT consumed.
 *
 * ## The ruling this file pins
 *
 * `className` / `gridClassName` on the form-view section family sit on the
 * SDUI-only side of the authorable boundary: `@objectstack/spec` deliberately
 * does not declare them for these views (its `component.zod.ts` says so in
 * as many words) and the authorable-surface ledger carries no entry for them.
 * The renderer nevertheless reached them off the parsed view through `as any`
 * at seven sites — the boundary declared on one side and crossed on the other.
 *
 * Maintainer ruling 2026-09-01 (director decision batch C, verbatim「同意」):
 * **retire the reads**. Declaring the keys was weighed and NOT adopted — it
 * would formally invite free Tailwind strings into authored metadata, the exact
 * class the boundary exists to keep out, and per ADR-0065 / ADR-0080
 * (rev. 2026-06-30) utility classNames in runtime metadata are never scanned by
 * the build-time Tailwind, so they silently produce no CSS anyway.
 *
 * ## Why this pin is BEHAVIOURAL and not a source grep
 *
 * ⚠️ When this file was written the retired reads did not need their casts:
 * `ObjectFormSection` (this repo's own `@object-ui/types`) still declared both
 * keys, so a "cleanup" writing a plain `className: s.className` type-checked
 * and silently restored consumption. objectui#7200 has since removed the two
 * members (pinned at the type level in @object-ui/types'
 * `object-form-section-style-keys-undeclared.test.ts`), so an UNCAST read now
 * fails to compile — but a cast one (`(s as any).className`, the exact shape
 * the seven retired sites had) still compiles, and metadata arriving as JSON
 * carries whatever an author wrote regardless of the TypeScript face. A grep
 * for `as any` would stay green through exactly the regression this file
 * exists to catch. So each row authors the keys — as UNDECLARED keys, through
 * a fixture type widened at this boundary and nowhere else — and asserts the
 * strings never reach the DOM.
 *
 * ## The liveness control — why every row asserts something PRESENT
 *
 * An "absent from the DOM" assertion is satisfied for free by a form that
 * failed to render, by a section that was never processed, and by a typo in the
 * mount. Each row therefore first waits on the section's own label: the
 * sentinel's absence is a verdict only once the node carrying it demonstrably
 * rendered. `columns: 2` is authored alongside for the same reason — it is a
 * sibling key on the same node that IS still consumed, so the section object
 * reaching the layout is not in question.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Restore the copy at any ONE of the seven sites and exactly the rows that
 * mount that arm go red in the PRESENT direction (the sentinel class reappears
 * in the markup); every other row stays green. Measured that way — see the PR.
 *
 * ## Scope boundary this file does NOT cross
 *
 * The form ROOT `className` (`ObjectFormSchema.className`, read as plain
 * `schema.className` and forwarded to the form wrapper) is a different key on a
 * different node and was NOT part of the ruling — it is deliberately unpinned
 * here. Rows below assert only the SECTION-level keys.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import type { ObjectFormSection } from '@object-ui/types';
import { ObjectForm } from '../ObjectForm';
import { DrawerForm } from '../DrawerForm';

registerAllFields();

/**
 * Sentinels, not plausible Tailwind. A real utility string ('p-4') could reach
 * the DOM from the layout's own chrome and make a row lie in either direction.
 */
const SECTION_CLASS = 'os13626-authored-section-class';
const GRID_CLASS = 'os13626-authored-grid-class';

/**
 * TWO sections, both authoring the style keys plus a consumed sibling
 * (`columns`). Two rather than one on purpose: a form declaring a SINGLE
 * section never engages the tab arm at all (the renderer needs more than one
 * usable tab), so a one-section fixture would have scored the tabbed row
 * against the stacked layout — measured, not assumed: it was a one-section
 * fixture that made the tabbed and wizard rows fail their liveness wait here.
 */
/**
 * The authored fixture shape: `ObjectFormSection` plus the two keys it no
 * longer declares (objectui#7200). Widened HERE, at the fixture boundary, and
 * nowhere else — the pin's subject is that an author CAN still put these keys
 * into JSON metadata and the renderer must not honour them. Deleting the keys
 * from the fixture instead would make every row below pass for free.
 */
type AuthoredSectionWithRetiredStyleKeys = ObjectFormSection & {
  className: string;
  gridClassName: string;
};

const sections = (): AuthoredSectionWithRetiredStyleKeys[] => [
  {
    name: 'always',
    label: 'Always',
    columns: 2,
    fields: ['subject'],
    className: SECTION_CLASS,
    gridClassName: GRID_CLASS,
  },
  {
    name: 'second',
    label: 'Second',
    columns: 2,
    fields: ['detail'],
    className: SECTION_CLASS,
    gridClassName: GRID_CLASS,
  },
];

const objectSchema = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    detail: { type: 'text', label: 'Detail' },
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

/** Mount through `ObjectForm` — the entry `RecordFormPage` itself uses. */
const renderObjectForm = async (extra: Record<string, unknown>) => {
  render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'crm_case',
        mode: 'create',
        sections: sections(),
        ...extra,
      } as any}
      dataSource={dataSource}
    />,
  );
  // Liveness control: the section demonstrably rendered before we judge absence.
  // `getAllBy*`, not `getBy*`: the wizard legitimately renders the label twice
  // (step-indicator entry + section heading) and `getByText` throws on the
  // duplicate — an inability, which must not read as a verdict here.
  await waitFor(() => expect(screen.getAllByText('Always').length).toBeGreaterThan(0));
};

/** Mount `DrawerForm` directly — the shape `resolveFormViewLayout` produces. */
const renderDrawerFormDirect = async () => {
  render(
    <DrawerForm
      schema={{
        type: 'object-form',
        objectName: 'crm_case',
        mode: 'create',
        open: true,
        sections: sections(),
      } as any}
      dataSource={dataSource}
    />,
  );
  // `getAllBy*`, not `getBy*`: the wizard legitimately renders the label twice
  // (step-indicator entry + section heading) and `getByText` throws on the
  // duplicate — an inability, which must not read as a verdict here.
  await waitFor(() => expect(screen.getAllByText('Always').length).toBeGreaterThan(0));
};

/**
 * Every arm whose synthesis site this card edited, named individually: a
 * restore applied to six of seven sites still passes a suite that exercises six.
 */
const LAYOUTS: { label: string; mount: () => Promise<void> }[] = [
  {
    label: "ObjectForm — stacked 'simple' sections (ObjectForm.tsx section-divider site)",
    mount: () => renderObjectForm({ formType: 'simple' }),
  },
  {
    label: "TabbedForm — formType 'tabbed' via ObjectForm delegation (tabbed section map)",
    mount: () => renderObjectForm({ formType: 'tabbed' }),
  },
  {
    label: "WizardForm — formType 'wizard' via ObjectForm delegation (wizard step map)",
    mount: () => renderObjectForm({ formType: 'wizard' }),
  },
  {
    label: "SplitForm — formType 'split' via ObjectForm delegation (split section map)",
    mount: () => renderObjectForm({ formType: 'split' }),
  },
  {
    label: "ModalForm — formType 'modal' via ObjectForm delegation (modal section map)",
    mount: () => renderObjectForm({ formType: 'modal', open: true }),
  },
  {
    label: "DrawerForm — formType 'drawer' via ObjectForm delegation (drawer section map)",
    mount: () => renderObjectForm({ formType: 'drawer', open: true }),
  },
  {
    // The seventh site: DrawerForm's OWN divider read, which the ObjectForm
    // drawer map above cannot cover — mounting DrawerForm directly is the only
    // route that reaches it with an authored section.
    label: 'DrawerForm — mounted directly (DrawerForm.tsx section-divider site)',
    mount: () => renderDrawerFormDirect(),
  },
];

/** Everything rendered anywhere in the document, chrome included. */
const markup = () => document.body.innerHTML;

describe('objectstack#13626 — authored section `className`/`gridClassName` are not consumed', () => {
  describe('the authored strings never reach the DOM', () => {
    for (const layout of LAYOUTS) {
      it(layout.label, async () => {
        await layout.mount();
        expect(markup()).not.toContain(SECTION_CLASS);
        expect(markup()).not.toContain(GRID_CLASS);
        // Same verdict through the DOM's own class index, so a row cannot pass
        // on an HTML-escaping accident rather than on non-consumption.
        expect(document.querySelector(`.${SECTION_CLASS}`)).toBeNull();
        expect(document.querySelector(`.${GRID_CLASS}`)).toBeNull();
      });
    }
  });

  describe('the sentinel harness itself can fail (control)', () => {
    // Without this, every row above is satisfied by a `markup()` that never
    // contains ANY class — the exact phantom-check the liveness wait is there
    // to prevent. This row proves the assertion's subject is a live document
    // whose classes this locator really reads.
    it('markup() sees classes that ARE rendered, and querySelector finds them', async () => {
      await renderObjectForm({ formType: 'simple' });
      const withClass = document.querySelector('[class]');
      expect(withClass).not.toBeNull();
      const cls = withClass!.className.toString().split(/\s+/).filter(Boolean)[0];
      expect(cls).toBeTruthy();
      expect(markup()).toContain(cls);
      expect(document.querySelector(`.${CSS.escape(cls)}`)).not.toBeNull();
    });
  });
});
