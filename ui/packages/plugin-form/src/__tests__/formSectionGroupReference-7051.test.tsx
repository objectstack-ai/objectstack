/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `form.sections[].group` — the view-level half of objectstack#13855
 * (objectui#7051), the sibling of objectui#8497's `record:details` half.
 *
 * ⭐ WHICH LEG DISCRIMINATES, said out loud so nobody re-reads the weak one as
 * the strong one. `SIBLING_SECTION_SURVIVES` and `FORM_IS_NOT_BLANKED` are
 * NON-REGRESSION legs: both PASS under the caricature (a resolver that answers
 * the same thing for every input), because sibling sections are exactly what a
 * caricature preserves — this is the correction objectui#8497 recorded after
 * its own stated axis failed to discriminate. The leg that separates the fix
 * from the plausible wrong one is `SECTION_GROUP_RENDERS_ITS_OWN_MEMBERS`: two
 * sections referencing two DIFFERENT groups, each asserted to render exactly
 * the members ITS group declares, by concrete field identifier and in order.
 * "The section is non-empty" would be decorative; "the form renders" passes on
 * a form that silently drops every group-referenced section, which is what
 * five of the six layouts did before this card.
 *
 * ⚠️ The two surfaces are NOT symmetric, measured rather than inferred:
 *   - `simple` THREW `Cannot read properties of undefined (reading 'map')` out
 *     of `SimpleObjectForm`'s own body (`ObjectForm.tsx`, the section loop
 *     above the returned JSX) and blanked the whole form — the same
 *     above-the-loop shape `record:details` had, so a per-section boundary
 *     could not have contained it either.
 *   - `tabbed` / `split` / `drawer` / `modal` did NOT throw: `buildSectionFields`
 *     spells the same read `section.fields ?? []`, so the section silently
 *     rendered nothing, with no diagnostic.
 *   - `wizard` rendered an empty step ("No fields configured for this step").
 * Both failure modes are pinned below.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { FormSectionSchema, FormViewSchema } from '@objectstack/spec/ui';
import { ObjectForm } from '../ObjectForm';
import {
  resolveSectionGroupReferences,
  resetSectionGroupReports,
  hasSectionGroupReference,
} from '../sectionGroups';

registerAllFields();

// ─── Fixture ──────────────────────────────────────────────────────────────

/**
 * Two declared groups with DISTINCT members, plus an ungrouped field and the
 * harness anchor. Distinct membership is what makes the discriminating leg
 * discriminate: a resolver that returns one constant member list cannot
 * satisfy both group sections at once.
 */
const TICKET = {
  name: 'ticket',
  fieldGroups: [
    { key: 'contact_info', label: 'Contact Info' },
    { key: 'billing', label: 'Billing Details' },
    { key: 'archive', label: 'Archive', description: 'Retired references', collapse: 'collapsed' },
  ],
  fields: {
    email: { type: 'text', label: 'Email Address', group: 'contact_info' },
    phone: { type: 'text', label: 'Phone Number', group: 'contact_info' },
    invoice_no: { type: 'text', label: 'Invoice No', group: 'billing' },
    po_number: { type: 'text', label: 'PO Number', group: 'billing' },
    old_ref: { type: 'text', label: 'Old Ref', group: 'archive' },
    channel: { type: 'text', label: 'Channel' },
    anchor_note: { type: 'text', label: 'Anchor Note' },
  },
};

const makeDS = (objectSchema: any = TICKET) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn().mockResolvedValue({ id: 't1' }),
    findOne: vi.fn().mockResolvedValue({ id: 't1' }),
  }) as any;

/** The anchor every rendered form carries — no leg asserts anything about it. */
const ANCHOR = { label: 'Harness Anchor', fields: ['anchor_note'] };

// ─── Harness ──────────────────────────────────────────────────────────────

/**
 * Harness-kill leg. Fires in BOTH directions — zero anchors and duplicated
 * anchors — so a caricature cannot satisfy the harness by adding a section,
 * and its text is unlike every content assertion in this file, so a harness
 * death can never be read as a content failure.
 */
function requireLiveForm(): HTMLFormElement {
  const forms = document.body.querySelectorAll('form');
  if (forms.length !== 1) {
    throw new Error(`HARNESS DEAD: expected exactly 1 <form>, found ${forms.length}`);
  }
  const anchors = Array.from(forms[0].querySelectorAll('input[name="anchor_note"]'));
  if (anchors.length !== 1) {
    throw new Error(
      `HARNESS DEAD: expected exactly 1 anchor input, found ${anchors.length}`,
    );
  }
  return forms[0] as HTMLFormElement;
}

/**
 * The rendered form's structure, in document order: `H:<label>` for a section
 * heading, `F:<name>` for a field input. Structural on purpose — presence
 * alone would not catch a resolver that gave every section the same members.
 */
function formOutline(form: HTMLElement): string[] {
  const out: string[] = [];
  form.querySelectorAll('input[name], .col-span-full').forEach((el) => {
    if (el.tagName === 'INPUT') {
      out.push(`F:${el.getAttribute('name')}`);
    } else if (el.classList.contains('border-b')) {
      out.push(`H:${(el.textContent ?? '').trim()}`);
    }
  });
  return out;
}

let uiErrors: string[] = [];
let uiWarns: string[] = [];
let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetSectionGroupReports();
  uiErrors = [];
  uiWarns = [];
  // Only this repo's own diagnostics are collected: React's act() advice also
  // arrives on console.error, and counting it would make "reported once"
  // depend on React's internals rather than on the reporter under test.
  errSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    const s = args.map(String).join(' ');
    if (s.includes('[object-ui]')) uiErrors.push(s);
  });
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
    const s = args.map(String).join(' ');
    if (s.includes('[object-ui]')) uiWarns.push(s);
  });
});

afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
  cleanup();
});

const renderForm = async (formType: string, sections: any[], ds = makeDS()) => {
  render(
    <ObjectForm
      schema={{
        type: 'object-form',
        formType,
        objectName: 'ticket',
        mode: 'create',
        open: true,
        sections,
      } as any}
      dataSource={ds}
    />,
  );
  await waitFor(
    () => {
      expect(document.body.querySelectorAll('form').length).toBe(1);
      expect(
        document.body.querySelectorAll('input[name="anchor_note"]').length,
      ).toBe(1);
    },
    { timeout: 4000 },
  );
};

// ─── The renderer legs ────────────────────────────────────────────────────

describe('objectui#7051 — `form.sections[].group` resolves through the single assembler', () => {
  it('⭐ SECTION_GROUP_RENDERS_ITS_OWN_MEMBERS — each group section renders exactly the members ITS group declares', async () => {
    await renderForm('simple', [
      { group: 'contact_info' },
      { group: 'billing' },
      { label: 'Extra', fields: ['channel'] },
      ANCHOR,
    ]);

    const form = requireLiveForm();
    // The whole structure, in order. Not "the section is non-empty": a
    // constant member list, or every section resolving to the same group,
    // changes this array. So does dropping a group section, which is what
    // this renderer did before the card.
    expect(formOutline(form)).toEqual([
      'H:Contact Info',
      'F:email',
      'F:phone',
      'H:Billing Details',
      'F:invoice_no',
      'F:po_number',
      'H:Extra',
      'F:channel',
      'H:Harness Anchor',
      'F:anchor_note',
    ]);
    // Membership is exclusive in both directions — `billing`'s members are not
    // in `contact_info`'s section and vice versa. Stated separately from the
    // outline so the failure message says WHICH half broke.
    expect(form.querySelectorAll('input[name="invoice_no"]').length).toBe(1);
    expect(form.querySelectorAll('input[name="old_ref"]').length).toBe(0);
    expect(uiErrors).toEqual([]);
  });

  it('SECTION_GROUP_LABEL_IS_THE_GROUPS_OWN — presentation comes from the object, not from the section', async () => {
    // ⚠️ `billing`, the SECOND declared group, deliberately — measured: with
    // `contact_info` (the first) this leg stayed GREEN under the "every section
    // resolves to the same group" caricature, because the first group is what
    // that caricature happens to return. A leg that a caricature satisfies by
    // accident is not testing the thing it names.
    await renderForm('simple', [{ group: 'billing' }, ANCHOR]);
    const form = requireLiveForm();
    // The referencing section cannot declare a label (the spec refuses it), so
    // a heading reading "Billing Details" can only have come from the object's
    // `fieldGroups` entry through `deriveFieldGroupLayout`.
    expect(formOutline(form)).toEqual([
      'H:Billing Details',
      'F:invoice_no',
      'F:po_number',
      'H:Harness Anchor',
      'F:anchor_note',
    ]);
  });

  it('SIBLING_SECTION_SURVIVES (non-regression — passes under the caricature, kept for the contrast)', async () => {
    await renderForm('simple', [
      { group: 'contact_info' },
      { label: 'Extra', fields: ['channel'] },
      ANCHOR,
    ]);
    const form = requireLiveForm();
    expect(form.querySelectorAll('input[name="channel"]').length).toBe(1);
    expect(form.textContent).toContain('Extra');
  });

  it('FORM_IS_NOT_BLANKED — a `{ group }` section no longer takes the whole simple form down (non-regression)', async () => {
    // Before this card this exact render produced an EMPTY document: the
    // section loop in `SimpleObjectForm`'s body threw
    // `Cannot read properties of undefined (reading 'map')` above the JSX it
    // returns, so React unmounted the tree and the well-formed siblings went
    // with it. `requireLiveForm` finding one live <form> IS the assertion.
    await renderForm('simple', [{ group: 'contact_info' }, ANCHOR]);
    expect(requireLiveForm().querySelectorAll('input').length).toBeGreaterThan(0);
  });

  it('SECTION_WITHOUT_MEMBERS_IS_BOUNDED — the second containment layer, pinned separately from the resolution', async () => {
    // ⚠️ Added because the ablation said the guard was otherwise UNPINNED —
    // the same discovery objectui#8497 recorded. With `group` resolved, a
    // `{ group }` section becomes one carrying `fields` BEFORE the section loop
    // sees it, so every group leg above stays green with the tolerant read
    // reverted. This leg is the only one that fails then: a section carrying
    // NEITHER `fields` nor `group` — off-spec, so reachable only from a
    // programmatic SDUI caller — must render nothing instead of throwing
    // `Cannot read properties of undefined (reading 'map')` out of a body above
    // the JSX and taking the whole form with it.
    await renderForm('simple', [
      { label: 'Memberless' } as any,
      { label: 'Extra', fields: ['channel'] },
      ANCHOR,
    ]);
    const form = requireLiveForm();
    expect(form.querySelectorAll('input[name="channel"]').length).toBe(1);
  });

  it('UNKNOWN_GROUP_RENDERS_NOTHING_AND_REPORTS_ONCE', async () => {
    await renderForm('simple', [
      { group: 'no_such_group' },
      { label: 'Extra', fields: ['channel'] },
      ANCHOR,
    ]);
    const form = requireLiveForm();
    // Renders nothing — no phantom heading, no borrowed members — and the
    // sibling is untouched.
    expect(formOutline(form)).toEqual([
      'H:Extra',
      'F:channel',
      'H:Harness Anchor',
      'F:anchor_note',
    ]);
    // Dropped, but never silently: `@objectstack/spec` assigns EXISTENCE to
    // `@objectstack/lint`'s `form-section-group-unknown`, not to parse, so the
    // renderer is the only place an author gets told at runtime.
    expect(uiErrors).toHaveLength(1);
    expect(uiErrors[0]).toContain('no_such_group');
    expect(uiErrors[0]).toContain('form-section-group-unknown');
  });

  it('GROUP_OWNED_KEY_BESIDE_GROUP_IS_IGNORED_AND_REPORTED — no override semantics, and not silent either', async () => {
    // `@objectstack/spec` refuses this shape at parse (pinned below), so it
    // only reaches the renderer from a programmatic SDUI caller. The group's
    // own label still wins — the spec grants no override — and the ignored key
    // is reported rather than quietly honoured or quietly dropped.
    await renderForm('simple', [
      { group: 'contact_info', label: 'My Own Label', collapsible: true },
      ANCHOR,
    ]);
    const form = requireLiveForm();
    expect(formOutline(form)[0]).toBe('H:Contact Info');
    expect(form.textContent).not.toContain('My Own Label');
    expect(uiWarns).toHaveLength(1);
    expect(uiWarns[0]).toContain('`label`');
    expect(uiWarns[0]).toContain('`collapsible`');
  });

  it('WIZARD_STEP_GROUP_IS_REFUSED_AND_REPORTED — the renderer agrees with the spec instead of inventing semantics', async () => {
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          formType: 'wizard',
          objectName: 'ticket',
          mode: 'create',
          sections: [{ group: 'contact_info' }, { label: 'Step Two', fields: ['channel'] }],
        } as any}
        dataSource={makeDS()}
      />,
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain('Step');
    }, { timeout: 4000 });
    // Not resolved: a wizard step has no slot for the `collapse` /
    // `visibleWhen` a group carries, which is exactly why the spec refuses the
    // combination. Rendering it would mean the wizard's own key-by-key step map
    // silently dropped both keys.
    expect(document.body.querySelectorAll('input[name="email"]').length).toBe(0);
    expect(document.body.querySelectorAll('input[name="phone"]').length).toBe(0);
    expect(uiWarns).toHaveLength(1);
    expect(uiWarns[0]).toContain('wizard');
  });
});

// ─── The five container layouts ───────────────────────────────────────────

/**
 * Resolution happens ONCE, above `ObjectForm`'s routing fork, so every layout
 * inherits it. These rows are what makes that claim checkable: a future
 * re-fork shows up as one layout's row going red while the others stay green.
 *
 * `tabbed` renders only the ACTIVE tab, so the group section is first there.
 */
const CONTAINERS: Array<[string, any[]]> = [
  ['tabbed', [{ group: 'billing' }, ANCHOR]],
  ['split', [{ group: 'billing' }, ANCHOR]],
  ['drawer', [{ group: 'billing' }, ANCHOR]],
  ['modal', [{ group: 'billing' }, ANCHOR]],
];

describe.each(CONTAINERS)(
  'objectui#7051 — %s inherits the resolution from the one site above the fork',
  (formType, sections) => {
    it('renders the referenced group\'s OWN members', async () => {
      // `billing` — the SECOND declared group, for the reason spelled out on
      // SECTION_GROUP_LABEL_IS_THE_GROUPS_OWN: referencing the first one let a
      // constant-resolution caricature satisfy these rows by accident.
      await renderForm(formType, sections);
      const form = requireLiveForm();
      expect(form.querySelectorAll('input[name="invoice_no"]').length).toBe(1);
      expect(form.querySelectorAll('input[name="po_number"]').length).toBe(1);
      // Exclusive: not somebody else's members.
      expect(form.querySelectorAll('input[name="email"]').length).toBe(0);
      expect(form.textContent).toContain('Billing Details');
      expect(uiErrors).toEqual([]);
    });
  },
);

// ─── The resolver, as a unit ──────────────────────────────────────────────

describe('objectui#7051 — resolveSectionGroupReferences', () => {
  const opts = { objectName: 'ticket', objectDef: TICKET } as const;

  it('returns its input UNCHANGED (same reference) when no section uses the reference form', () => {
    const sections = [{ label: 'Extra', fields: ['channel'] }] as any;
    expect(resolveSectionGroupReferences(sections, opts)).toBe(sections);
    expect(hasSectionGroupReference(sections)).toBe(false);
    expect(resolveSectionGroupReferences(undefined, opts)).toBeUndefined();
  });

  it('carries the group\'s presentation — label, description and the collapse pair', () => {
    // `collapse: 'collapsed'` on the object's group becomes the renderer's
    // boolean pair, and `description` rides along: both are GROUP-owned per the
    // spec, so a key-by-key rebuild that dropped either would leave the
    // reference form unable to inherit it from anywhere.
    const [resolved] = resolveSectionGroupReferences([{ group: 'archive' }] as any, opts)!;
    expect(resolved).toEqual({
      name: 'archive',
      label: 'Archive',
      description: 'Retired references',
      fields: ['old_ref'],
      collapsible: true,
      collapsed: true,
    });
  });

  it('keeps the two layout keys the spec PERMITS beside `group`, and only those', () => {
    const [resolved] = resolveSectionGroupReferences(
      [{ group: 'billing', columns: 3, pane: 'secondary', label: 'ignored' }] as any,
      opts,
    )!;
    expect(resolved.columns).toBe(3);
    expect(resolved.pane).toBe('secondary');
    // The group's own label wins; the authored one is not merged in.
    expect(resolved.label).toBe('Billing Details');
    expect((resolved as any).group).toBeUndefined();
  });

  it('leaves a reference EMPTY rather than dropping it while the object definition is still loading', () => {
    // Emptying and dropping both render nothing. Dropping is what this surface
    // cannot afford: an emptied `sections` array stops being a sectioned form
    // and falls back to the flat every-field layout, so one mistyped key would
    // render MORE than the author asked for.
    const out = resolveSectionGroupReferences(
      [{ group: 'contact_info' }, { label: 'Extra', fields: ['channel'] }] as any,
      { objectName: 'ticket', objectDef: null },
    )!;
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ fields: [] });
    // Nothing reported: a pending load is not a dangling reference.
    expect(uiErrors).toEqual([]);
  });

  it('does not resolve a group nothing points at — the assembler already dropped it', () => {
    const [resolved] = resolveSectionGroupReferences([{ group: 'contact_info' }] as any, {
      objectName: 'ticket',
      objectDef: { ...TICKET, fields: { channel: { type: 'text' } } },
    })!;
    expect(resolved).toEqual({ fields: [] });
    expect(uiErrors).toHaveLength(1);
  });
});

// ─── The spec's own refusals, pinned where they are actually enforced ─────

/**
 * ⭐ The second axis. The card asks that group-owned presentation keys beside
 * `group`, and `group` on a wizard step, not be SILENTLY accepted. Measured
 * against the installed `@objectstack/spec` (18.1.0): both are refused at PARSE
 * — a stronger door than the lint that objectui#8497 concluded owns EXISTENCE
 * checking, and a different one. So authored metadata carrying either never
 * reaches this renderer at all; the renderer's own reports above exist for the
 * programmatic SDUI callers that do not pass this door.
 *
 * Pinned here because "enforcement lives upstream" is a claim about upstream,
 * and a claim nothing checks is how a door quietly stops closing.
 */
describe('objectui#7051 — @objectstack/spec is the enforcing door for the two refusals', () => {
  const refusal = (input: unknown, schema: any = FormSectionSchema) => {
    const r = schema.safeParse(input);
    expect(r.success).toBe(false);
    return (r as any).error.issues.map((i: any) => `${i.code}:${i.path.join('.')}`);
  };

  it('refuses `group` beside `fields` — a section declares its members exactly one way', () => {
    expect(refusal({ group: 'contact_info', fields: ['email'] })).toContain('custom:group');
    expect(refusal({ label: 'x' })).toContain('custom:fields');
  });

  it('refuses every group-owned presentation key beside `group`, and PERMITS the layout pair', () => {
    for (const key of ['name', 'label', 'description', 'collapsible', 'collapsed', 'visibleWhen']) {
      const value = key === 'collapsible' || key === 'collapsed' ? true : 'v';
      expect(refusal({ group: 'contact_info', [key]: value })).toContain(`custom:${key}`);
    }
    expect(FormSectionSchema.safeParse({ group: 'contact_info', columns: 2 }).success).toBe(true);
    expect(FormSectionSchema.safeParse({ group: 'contact_info', pane: 'primary' }).success).toBe(true);
  });

  it('refuses `group` on a wizard step, and accepts it on every other form type', () => {
    const view = (type: string) => ({ type, sections: [{ group: 'contact_info' }, { fields: ['channel'] }] });
    expect(refusal(view('wizard'), FormViewSchema)).toContain('custom:sections.0.group');
    for (const type of ['simple', 'tabbed', 'split', 'drawer', 'modal']) {
      expect(FormViewSchema.safeParse(view(type)).success).toBe(true);
    }
  });

  it('refuses the `fieldGroup` / `groupKey` alias spellings rather than folding them', () => {
    // ⚠️ Recorded because the dispatch order carried the opposite premise. On
    // `FormSectionSchema` these are NOT folded to `group`: they are
    // unrecognized keys, refused with a "did you mean" hint. A renderer-side
    // fold would therefore be a second, more permissive contract.
    for (const alias of ['fieldGroup', 'groupKey']) {
      expect(refusal({ [alias]: 'contact_info' })).toContain('unrecognized_keys:');
    }
  });

  it('refuses a key that breaks the shared grammar (FIELD_GROUP_KEY_PATTERN)', () => {
    expect(refusal({ group: 'Not A Key' })).toContain('invalid_format:group');
  });
});
