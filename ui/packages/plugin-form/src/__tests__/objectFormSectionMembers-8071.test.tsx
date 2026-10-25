/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.sections` — the MEMBER shape this renderer reads (objectui#8071,
 * criterion from objectui#8068).
 *
 * Nothing declared says what a section IS. The registration is a bare
 * `{ name: 'sections', type: 'array' }` — no `of`, no description — and
 * `@objectstack/spec`'s `ComponentPropsMap['object-form'].sections` is
 * `z.array(z.unknown()).optional()`, so every array of anything parses on both
 * sides. The read site is therefore the whole member contract, which is the
 * population objectui#8068 refuses to leave unwatched.
 *
 * WHAT THE RENDERER READS, measured in `SimpleObjectForm`'s grouped branch in
 * `ObjectForm.tsx` — the DEFAULT layout, the one a section-carrying form gets
 * when it declares no `formType`. A member is an object, and six of its keys
 * are read there: `fields` (the membership), `name` and `label` (the heading
 * and the collapse-state key), `collapsed` and `collapsible` (the two halves of
 * the disclosure), and `columns` (the per-section density).
 *
 * ⛔ SCOPE, stated so this pin is not over-read. Five other layouts rebuild a
 * section key by key (`tabbed` / `wizard` / `split` / `drawer` / `modal`), and
 * neighbouring files already own the member facts that are ABOUT those
 * rebuilds rather than about the member shape: `sectionVisibleWhen-6111` and
 * `sectionPredicateLayoutDiagnostic-6237` own `visibleWhen`,
 * `formSectionGroupReference-7051` owns the `{ group }` reference form,
 * `groupsAlias` owns the legacy `groups` spelling folding onto this key, and
 * `drawerFormSectionDescription-9834` owns `description` on the DRAWER arm —
 * a separate site that lost the same key one layer later and was repaired
 * separately. This file is the default layout only, and it is the only one
 * registered as the member pin for the key.
 *
 * ⚠️ Row 10 is the ONE deliberate exception to that scope, and it is scoped in
 * turn: it mounts the four sibling arms to assert ONLY that a headingless
 * member's blurb still reaches them, because the fix rows 7-9 pin would
 * otherwise be satisfiable by breaking those four. ⛔ It re-derives no other
 * fact about them and is ⛔ not a second home for their pins.
 *
 * ⭐ Row 1 is the member ORDER, and it FLIPPED with objectui#10475 — the way
 * rows 4, 6, 7, 8 and 9 below flipped before it: it pinned a DEFECT as
 * behaviour. It used to require that a section's `fields` read as a SET, not
 * as an order, because the loop spelled the resolution as a name filter over
 * the parent field pool — so the fields came out in the OBJECT's order, the
 * order the author wrote inside the section was discarded, and the five
 * sibling arms, which build a section through `buildSectionFields`, drew the
 * same `sections` block in the authored order. objectui#10475 was graded as
 * that divergence (triage execution notes: 「the section's authored order」)
 * and moved this arm onto the shared builder, so the row now pins the
 * AUTHORED order, which also agrees with the sibling key on the same block:
 * `object-form.fields` is pinned (objectFormFieldsMembers-8071) on authored
 * order being PRESERVED. Its job did not change — it is still the only row
 * here watching the member order, and it must fail if the order stops being
 * the section's. The member overrides the same card moved, and the order on
 * every arm, are pinned in `sectionEntryOverrides-10475`.
 *
 * Row 2 is the silent one: a section whose members resolve to no field at all
 * is dropped WHOLE — the loop returns before it pushes a heading, so a typo in
 * one member name costs the author a heading they can see nothing wrong with.
 *
 * Row 3 pins the identity pair: `name` alone yields a heading (it is passed
 * through `sectionLabel(objectName, name, label || name)`), while a member
 * carrying NEITHER key renders its fields with no divider at all — the
 * "untitled trailing bucket" the ungrouped fields land in.
 *
 * Row 4 is the disclosure pair. `collapsed: true` takes the section's fields
 * out of the DOM while its heading stays, and the heading is a control
 * (`role="button"` / `aria-expanded`) whenever either member says so.
 *
 * ⚠️ FLIPPED, the way rows 6 and 7 below flipped before it, and for the same
 * reason: it pinned a DEFECT as behaviour. It used to require that a section
 * declaring `collapsed` and NOT `collapsible` carry no affordance at all —
 * i.e. that it render permanently closed, its fields out of the DOM and
 * nothing on the page able to bring them back. objectui#8071 slice 11 handed
 * that reading back as a finding (objectui#9780), and the maintainer ruled it
 * on 2026-09-18, letter A: `collapsed` IMPLIES `collapsible`. The row now
 * pins the implication, in the same change that made it true. Its job did not
 * change — it is still the only row here watching the disclosure pair, and it
 * must fail if either half stops.
 *
 * The two members remain SEPARATE and the implication runs one way only:
 * `collapsible: true` alone still means "open, with a control", which is why
 * this row keeps reading that spelling too. The deeper reading of the ruling —
 * including `collapsible: false` with `collapsed: true`, which resolves in
 * favour of `collapsed` — lives in `collapsedImpliesCollapsible-9780`.
 *
 * Row 5 is the non-vacuity control: with no `sections` at all the same three
 * fields render, with no divider anywhere — so rows 1-4 cannot be passing on a
 * form that draws nothing.
 *
 * Row 6 is the SEVENTH key, and it changed hands. It was written here as a
 * LIMIT — `description` is a member `SectionDivider` renders and the rebuild
 * arms copy, and this layout did NOT copy it, so the row pinned the DROP as
 * behaviour and handed it back as a finding, because objectui#8071 wrote pins
 * only. objectui#9779 took that finding and made the default layout copy the
 * key, so the row now pins the ARRIVAL: same fixture, same live control
 * (`label` on the same member, in the same call), opposite verdict. ⛔ The
 * row's job is unchanged and it is still the only thing watching this key —
 * it must go red if the blurb stops reaching the divider.
 *
 * ⚠️ Rows 7-9 are the BOUNDARY objectui#9779 handed back, now RULED —
 * objectui#9835, maintainer 2026-09-18, letter B. A member carrying a
 * `description` and NEITHER `name` nor `label` used to draw nothing at all on
 * this layout, because the divider row exists only for a member that yields a
 * heading (row 3's gate) — while `split` / `modal` / `wizard` / `tabbed` all
 * render that member's blurb. The ruling refused letter A (widen the gate to
 * `label || description`) because the SAME gate decides the ADR-0089
 * `visibleWhen` row and the objectui#6236 membership claim that gates the whole
 * group, plus the `collapsed` / `collapsible` pair whose "an untitled bucket is
 * never collapsible" rule it implements. ⇒ the member got a BLURB-ONLY row
 * that carried nothing else. objectui#9849's director ruling (letter E) then
 * separated the two questions that gate had fused: the row stays the
 * blurb-only row, and the group's predicate, membership claim and collapse
 * pair attach to the GROUP whether or not it yields a heading. Rows 7-9 pin
 * each half separately:
 *
 * - Row 7 — the blurb IS rendered, and NO divider heading comes with it. This
 *   is the row that FLIPPED: it recorded the drop as behaviour until this card
 *   (`blurbs` asserted `[]`), exactly as row 6 recorded its own drop before
 *   objectui#9779 fixed it. Its `headings` half did NOT flip — no heading is
 *   authored, so none is drawn, before and after.
 * - Rows 8-9 FLIPPED with objectui#9849 step two (director ruling letter E,
 *   maintainer 「同意」): 「Group-level semantics are independent of the
 *   heading … ⛔ A headingless group is never un-gated」 and 「The collapse
 *   control lives on the row」. The blurb-only row is still the row letter B
 *   gave this member — no heading, just the blurb — but it now carries the
 *   group's semantics like every other row:
 * - Row 8 — the blurb-only row IS the collapse control: `collapsed: true`
 *   takes the member's fields out of the DOM and the row hands them back.
 *   The absence control is the same member declaring neither key.
 * - Row 9 — the group's PREDICATE gates it: under the DENYING scope the blurb
 *   and the claimed member both go, under the ADMITTING scope both come back,
 *   so "gated" is measured against an instrument that both hides and shows.
 *
 * ⭐ Row 10 is the CROSS-ARM guard the ruling implies but no single-arm pin can
 * hold: the four arms that already rendered this member's blurb must still
 * render it. Without it, a future edit could "make the arms agree" by breaking
 * the four instead of keeping the fifth — the rows above would all stay green.
 * ⛔ It is NOT a second home for those arms' own facts (each arm's site owns
 * those, `drawerFormSectionDescription-9834` among them); it reads one thing
 * only, per arm, in both directions.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    note: { type: 'text', label: 'Note' },
    amount: { type: 'text', label: 'Amount' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

/** Mount a create-mode `object-form` in its DEFAULT layout and wait for the form. */
async function mount(schema: Record<string, unknown>): Promise<HTMLElement> {
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'invoice', mode: 'create', ...schema } as any}
      dataSource={makeDataSource()}
    />,
  );
  await waitFor(() => {
    if (!container.querySelector('form')) throw new Error('form not ready');
  });
  return container as HTMLElement;
}

/** The field controls actually drawn, in DOM order. */
const drawnFields = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

/** The section headings actually drawn, in DOM order. */
const headings = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('.border-b span')].map((el) => el.textContent ?? '');

/**
 * The section BLURBS actually drawn, in DOM order — read off the divider row
 * itself (`SectionDivider` renders the description as the `<p>` inside the same
 * `.border-b` block that carries the heading), not off the form's whole
 * `textContent`. A `textContent` read would be satisfied by the string
 * appearing anywhere at all — a field's own help text, a toast, a label — which
 * is fine for asserting ABSENCE and useless for asserting ARRIVAL.
 */
const blurbs = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('.border-b p')].map((el) => el.textContent ?? '');

/**
 * The disclosure CONTROLS actually drawn. `SectionDivider` is a control only
 * when it was handed `collapsible` — that is what puts `role="button"` on the
 * row — so counting them answers "did this member get a collapse affordance"
 * without asking how the row was built.
 */
const collapseControls = (c: HTMLElement): number =>
  c.querySelectorAll('[role="button"]').length;

/**
 * The canonical predicate wire shape: `@objectstack/spec` normalizes an
 * authored predicate into a `{ dialect: 'cel' }` envelope at parse (ADR-0089
 * D2), and a bare string routes to a different engine on some surfaces. Same
 * spelling as `sectionVisibleWhen-6111`, on purpose — one authored text, one
 * verdict, every surface.
 */
const cel = (source: string) => ({ dialect: 'cel', source });

/** THE authored section predicate for row 9. One text, two scopes. */
const GATE = cel("'sales_manager' in current_user.positions");

/** The host scope an `ExpressionProvider` mounts, transcribed (objectui#6010). */
const hostScope = (positions: string[]) => {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
};

/** The same mount as `mount`, with a predicate scope bound around it. */
async function mountWithScope(
  schema: Record<string, unknown>,
  scope: Record<string, unknown>,
): Promise<HTMLElement> {
  const { container } = render(
    <PredicateScopeProvider scope={scope as any}>
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'invoice', mode: 'create', ...schema } as any}
        dataSource={makeDataSource()}
      />
    </PredicateScopeProvider>,
  );
  await waitFor(() => {
    if (!container.querySelector('form')) throw new Error('form not ready');
  });
  return container as HTMLElement;
}

/**
 * Mount the SAME `object-form` under one of the sibling layout arms, for row 10.
 * Read off `document.body` rather than the RTL container because the modal arm
 * portals its body out of it — row 10 calls `cleanup()` between arms so the
 * body holds exactly one mount at a time.
 */
async function mountArm(
  formType: string,
  sections: Array<Record<string, unknown>>,
): Promise<HTMLElement> {
  render(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: 'invoice',
          mode: 'create',
          formType,
          open: true,
          sections,
        } as any
      }
      dataSource={makeDataSource()}
    />,
  );
  await waitFor(() => {
    if (!document.body.querySelector('form')) throw new Error('form not ready');
  });
  return document.body;
}

describe('`object-form` — the member shape of `sections`', () => {
  it('1. a member’s `fields` are field NAMES drawn in the SECTION’s authored order, ⛔ not the object’s (objectui#10475)', async () => {
    // ⚠️ FLIPPED by objectui#10475, in the same change that made it true — see
    // this file's header. It used to assert `['customer', 'note']`, pinning the
    // object's order winning over the authored one as behaviour.
    const c = await mount({
      sections: [{ name: 'main', label: 'Main', fields: ['note', 'customer'] }],
    });
    expect(headings(c)).toEqual(['Main']);
    expect(
      drawnFields(c),
      'the section draws its members in the order it lists them (`note` before `customer`, the ' +
        'reverse of the object’s), as the five sibling arms do and as the sibling key ' +
        '`object-form.fields` does',
    ).toEqual(['note', 'customer']);
  });

  it('2. a member whose `fields` resolve to NOTHING is dropped whole — heading and all', async () => {
    const c = await mount({
      sections: [
        { label: 'Ghost', fields: ['nosuchfield'] },
        { label: 'Real', fields: ['amount'] },
      ],
    });
    expect(headings(c), 'a section that resolves no field never reaches a divider').toEqual(['Real']);
    expect(drawnFields(c)).toEqual(['amount']);
  });

  it('3. `name` alone titles the section; a member with NEITHER `name` nor `label` draws no divider', async () => {
    const named = await mount({ sections: [{ name: 'billing', fields: ['amount'] }] });
    expect(headings(named)).toEqual(['billing']);

    const untitled = await mount({ sections: [{ fields: ['amount'] }] });
    expect(headings(untitled), 'the untitled bucket renders its fields flat').toEqual([]);
    expect(drawnFields(untitled), '…and it still renders them').toEqual(['amount']);
  });

  it('4. `collapsed` removes the members from the DOM, and it IMPLIES `collapsible` — the heading is a control either way (objectui#9780)', async () => {
    // ⚠️ FLIPPED by objectui#9780 (maintainer ruling 2026-09-18, letter A), in
    // the same change that made the implication true — see this file's header.
    // The first block used to assert `.toBeNull()` here, pinning the trap as
    // behaviour: `collapsed` alone rendered a section nothing could reopen.
    const closed = await mount({
      sections: [{ label: 'Money', fields: ['amount'], collapsed: true }],
    });
    expect(headings(closed)).toEqual(['Money']);
    expect(drawnFields(closed), '`collapsed` takes the section’s fields out of the DOM').toEqual([]);
    const implied = closed.querySelector('[role="button"]');
    expect(
      implied,
      '⭐ …and the affordance to open it again is installed on the strength of `collapsed` ALONE',
    ).not.toBeNull();
    expect(implied?.getAttribute('aria-expanded')).toBe('false');

    const disclosable = await mount({
      sections: [{ label: 'Money', fields: ['amount'], collapsed: true, collapsible: true }],
    });
    const control = disclosable.querySelector('[role="button"]');
    expect(control, 'declaring `collapsible` as well changes nothing — same closed control').not.toBeNull();
    expect(control?.getAttribute('aria-expanded')).toBe('false');

    const open = await mount({
      sections: [{ label: 'Money', fields: ['amount'], collapsible: true }],
    });
    expect(
      drawnFields(open),
      'control: the members stay SEPARATE and the implication runs one way — `collapsible` alone ' +
        'is still an OPEN section that draws its member',
    ).toEqual(['amount']);
    expect(open.querySelector('[role="button"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('5. control: with NO `sections` the same fields render and no divider is drawn', async () => {
    const c = await mount({});
    expect(headings(c)).toEqual([]);
    expect(drawnFields(c)).toEqual(['customer', 'note', 'amount']);
  });

  it('6. a member’s `description` REACHES the divider, alongside its `label` (objectui#9779)', async () => {
    // ⚠️ This row previously pinned the OPPOSITE — `.not.toContain(...)`, the
    // drop recorded as behaviour by objectui#8071 slice 11 and handed back as a
    // finding. objectui#9779 fixed the default layout, so the row was rewritten
    // onto the new behaviour in the SAME change. Its job did not change: this
    // is still the only assertion watching whether the blurb reaches the
    // divider, and it must fail if it stops.
    const c = await mount({
      sections: [{ label: 'Money', description: 'Totals as invoiced', fields: ['amount'] }],
    });
    expect(headings(c), 'the live control: the sibling member on the SAME section reaches the divider').toEqual([
      'Money',
    ]);
    expect(
      blurbs(c),
      '`SectionDivider` renders a `description`; the default layout now hands it one, so the ' +
        'blurb is read off the divider itself — not off `textContent`, which a stray render ' +
        'of the same string anywhere in the form would satisfy',
    ).toEqual(['Totals as invoiced']);
    expect(drawnFields(c), 'and the section still draws its member').toEqual(['amount']);
  });

  it('7. the blurb-only row: a member with a `description` but NEITHER `name` nor `label` renders its blurb, and NO heading (objectui#9835)', async () => {
    // ⚠️ FLIPPED, deliberately and exactly once — the same way row 6 flipped
    // before it. Until objectui#9835 this row pinned the DROP as behaviour:
    // the divider row exists only for a member that yields a heading, so this
    // member drew nothing and its blurb was lost, while four sibling arms drew
    // it. The maintainer ruled letter B on 2026-09-18: give the member a row
    // that carries the blurb and NOTHING else, rather than widen the gate
    // (letter A), which would also have moved the ADR-0089 predicate, the
    // objectui#6236 membership claim and the collapse pair. ⇒ `blurbs` flips
    // from `[]` to the authored text; `headings` does NOT flip.
    const c = await mount({
      sections: [{ description: 'Totals as invoiced', fields: ['amount'] }],
    });
    expect(
      headings(c),
      '⛔ no heading is authored and none is synthesised — the blurb-only row carries no `label`, ' +
        'so `SectionDivider` draws no heading span',
    ).toEqual([]);
    expect(
      blurbs(c),
      'the blurb reaches the DOM through the blurb-only row, read off that row itself — ⛔ not ' +
        'off `textContent`, which a stray render of the same string would satisfy',
    ).toEqual(['Totals as invoiced']);
    expect(
      drawnFields(c),
      'the liveness control: the member itself still renders, so the heading negative above is ' +
        'about a form that drew something',
    ).toEqual(['amount']);

    // The instrument control for the negative: the SAME member with a `label`
    // added does produce a heading, so `headings` returning `[]` above is a
    // reading and ⛔ not a selector that matches nothing on this corpus.
    cleanup();
    const titled = await mount({
      sections: [{ label: 'Money', description: 'Totals as invoiced', fields: ['amount'] }],
    });
    expect(
      headings(titled),
      'the lit control on the same instrument and corpus: add the sibling `label` and a heading appears',
    ).toEqual(['Money']);
  });

  it('8. the blurb-only row carries the collapse control: `collapsed` closes the group and the row reopens it (objectui#9849, ruling E)', async () => {
    // ⚠️ FLIPPED by objectui#9849 step two. Until it, this row pinned letter
    // B's 「the blurb-only row carries nothing else」: no control, and
    // `collapsed` ignored. Director ruling letter E moved the collapse pair
    // onto the GROUP on every arm, with the control on whatever row the group
    // yields — and a blurb is a row.
    const headless = await mount({
      sections: [
        { description: 'Totals as invoiced', fields: ['amount'], collapsed: true, collapsible: true },
      ],
    });
    expect(headings(headless), 'still no heading — the row is the blurb-only row').toEqual([]);
    expect(blurbs(headless), 'the live control: the row itself is drawn').toEqual(['Totals as invoiced']);
    expect(collapseControls(headless), 'the blurb-only row is the disclosure control').toBe(1);
    expect(drawnFields(headless), '`collapsed: true` takes the member out of the DOM').toEqual([]);
    fireEvent.click(headless.querySelector('[role="button"]') as HTMLElement);
    await waitFor(() => {
      expect(drawnFields(headless), 'and the control on the row hands it back').toEqual(['amount']);
    });

    // The absence control, same instrument and corpus: declaring neither key
    // draws no control and keeps the member — so the `1` above is a reading.
    cleanup();
    const plain = await mount({ sections: [{ description: 'Totals as invoiced', fields: ['amount'] }] });
    expect(collapseControls(plain)).toBe(0);
    expect(drawnFields(plain)).toEqual(['amount']);
  });

  it('9. the blurb-only row carries the group predicate: a headingless group is never un-gated (objectui#9849, ruling E)', async () => {
    // ⚠️ FLIPPED by objectui#9849 step two — ruling letter E item 1 refused
    // exactly the un-gating this row used to pin (「B refused」). The
    // predicate and the objectui#6236 membership claim ride the group whether
    // or not it yields a heading.
    const denied = await mountWithScope(
      { sections: [{ description: 'Totals as invoiced', fields: ['amount'], visibleWhen: GATE }] },
      hostScope(['sales']),
    );
    expect(blurbs(denied), 'the DENYING scope hides the row').toEqual([]);
    expect(drawnFields(denied), '…and the member it claims (objectui#6236)').toEqual([]);

    // The live control: the SAME predicate under the ADMITTING scope shows
    // both — so the zeros above are a gate that evaluates, not one that hides
    // unconditionally.
    cleanup();
    const allowed = await mountWithScope(
      { sections: [{ description: 'Totals as invoiced', fields: ['amount'], visibleWhen: GATE }] },
      hostScope(['sales_manager']),
    );
    expect(blurbs(allowed)).toEqual(['Totals as invoiced']);
    expect(drawnFields(allowed)).toEqual(['amount']);
  });

  it('10. cross-arm guard: the four arms that already rendered a headingless blurb still do', async () => {
    // ⭐ WHY THIS ROW EXISTS. Rows 7-9 would stay green if a later edit made
    // the five arms agree by REMOVING the blurb from the other four. This row
    // is the other direction, and it is the whole reason the inconsistency was
    // worth a card: four arms rendered this member's blurb and the default one
    // did not.
    //
    // ⛔ Each arm is read at its OWN chrome, not through `textContent`: the
    // stacked arms (`split` / `modal`) draw the blurb on a `SectionDivider`
    // row, the wizard draws it in its step container, and the tabbed arm draws
    // it in the tab panel. Every read is paired with the SAME mount minus the
    // `description`, so a hit is a reading on an instrument that can report
    // none.
    const ARMS: Array<{ formType: string; blurb: (c: HTMLElement) => string[] }> = [
      { formType: 'split', blurb: (c) => [...c.querySelectorAll('.border-b p')].map((e) => e.textContent ?? '') },
      { formType: 'modal', blurb: (c) => [...c.querySelectorAll('.border-b p')].map((e) => e.textContent ?? '') },
      {
        formType: 'wizard',
        blurb: (c) => [...c.querySelectorAll('.form-section p.text-muted-foreground')].map((e) => e.textContent ?? ''),
      },
      {
        formType: 'tabbed',
        blurb: (c) => [...c.querySelectorAll('[role="tabpanel"] p.text-muted-foreground')].map((e) => e.textContent ?? ''),
      },
    ];

    for (const arm of ARMS) {
      // Two sections: the headingless one under test, plus a titled sibling —
      // the tabbed arm draws no tab strip below two sections, so a lone
      // section would measure its degraded shape instead of its tabs.
      const withBlurb = await mountArm(arm.formType, [
        { description: 'Totals as invoiced', fields: ['amount'] },
        { label: 'Other', fields: ['customer'] },
      ]);
      expect(
        arm.blurb(withBlurb),
        `the \`${arm.formType}\` arm renders a headingless member's blurb — ⛔ it must not be ` +
          'made to agree with the default arm by losing it',
      ).toEqual(['Totals as invoiced']);

      cleanup();
      const withoutBlurb = await mountArm(arm.formType, [
        { fields: ['amount'] },
        { label: 'Other', fields: ['customer'] },
      ]);
      expect(
        arm.blurb(withoutBlurb),
        `the absence control for \`${arm.formType}\`: the same mount with no \`description\` ` +
          'reports none, so the hit above is a reading',
      ).toEqual([]);
      cleanup();
    }
  });
});
