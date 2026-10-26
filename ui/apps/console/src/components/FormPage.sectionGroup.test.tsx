// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8641 — `FormPage.buildSections` honours a spec-legal
 * `form.sections[].group`.
 *
 * ## What was MEASURED before the fix, in the DOM (not read off the source)
 *
 * The card said, about itself, that its finding came from reading
 * `sec.fields ?? []` rather than from rendering anything. It was reproduced
 * first. `origin/main` at `a29ae2d66`, this file's own fixture, both routes:
 *
 *     buildSections -> [ {label:'Anchor', fields:['anchor_note']},
 *                        {columns:2, fields:[]},
 *                        {columns:2, fields:[]} ]
 *
 *     DOM (internal /forms/:name AND public /f/:slug, identical):
 *       SECTION heading="Anchor"  inputs=[anchor_note]
 *       SECTION heading=NONE      inputs=[]
 *       SECTION heading=NONE      inputs=[]
 *
 * So "renders nothing" is one word off: the `<section>` element IS emitted,
 * with its border, background and padding — the submitter sees two EMPTY CARDS
 * where the contact and billing inputs belong, and no diagnostic is printed on
 * any channel. The members the group declares are simply absent.
 *
 * ## ⭐ Which leg discriminates, said out loud
 *
 * `RENDERS_THE_ANCHOR` and "the group section is non-empty" are NOT the axis:
 * both are satisfied by today's builder, which drops every group-referenced
 * section while rendering the rest of the form perfectly. The load-bearing leg
 * is `EACH_GROUP_SECTION_RENDERS_ITS_OWN_MEMBERS` — two sections referencing
 * two DIFFERENT groups, each asserted against concrete field identifiers in
 * order.
 *
 * ⚠️ And the section that carries that leg references `billing`, the SECOND
 * declared group, deliberately. A constant-resolution caricature — a resolver
 * answering with the same derived section for every reference — returns the
 * FIRST declared group, so a leg written against `contact_info` alone stays
 * GREEN under it and proves nothing. That is not hypothetical: PR #8644's
 * author hit exactly it. Measured here (leg 3 below): with `byKey.get(group)`
 * replaced by "the first derived section", the `contact_info` assertions stay
 * green and only the `billing` ones turn red.
 *
 * ## ⛔ What this file does NOT pin, on purpose
 *
 * Declared order, the empty-group drop, the ungrouped trailing bucket and the
 * collapse / `visibleWhen` passthrough are `deriveFieldGroupLayout`'s
 * (ADR-0085 §5), reached through `@object-ui/plugin-form`'s one adapter. This
 * app re-implements none of them and therefore asserts none of them as its
 * own; what it asserts is that the section this app draws is the one that
 * assembler produced — which is why the label, the member list, the member
 * ORDER and the collapse booleans are all read back from the object's
 * `fieldGroups` rather than from anything written here.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormSectionSchema } from '@objectstack/spec/ui';
import { buildSections, FormPage } from './FormPage';
import type { FormViewSpec } from '@object-ui/app-shell';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Fixture ──────────────────────────────────────────────────────────────

/**
 * Three declared groups with DISTINCT members, an ungrouped field, and the
 * harness anchor. Distinct membership is what makes the discriminating leg
 * discriminate: one constant member list cannot satisfy two group sections.
 *
 * `contact_info` is declared FIRST and `billing` SECOND — see the header for
 * why that ordering is load-bearing rather than incidental.
 */
const TICKET = {
  name: 'ticket',
  label: 'Ticket',
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

/** The anchor every rendered form carries — no content leg asserts anything about it. */
const ANCHOR = { label: 'Anchor', fields: ['anchor_note'] };

/**
 * Build a `FormViewSpec` from raw authored sections.
 *
 * The cast is the finding this card did NOT take on: `FormSectionSpec` (the
 * app-shell authoring type this renderer reads) re-declares `fields` as
 * REQUIRED, so the spec-legal `{ group }` shape — which carries `fields`
 * neither at parse nor by construction — does not type-check for a TypeScript
 * author. Filed separately rather than widened here, because the same
 * declaration is `SchemaForm`'s (a fourth form-section renderer) and widening
 * it reaches into that renderer's unguarded `s.fields` reads.
 */
const formOf = (sections: unknown[], type = 'simple'): FormViewSpec =>
  ({ type, sections } as unknown as FormViewSpec);

interface Route_ { method?: string; match: string; body?: unknown }

function stubFetch(routes: Route_[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find(
      (r) => (r.method ?? 'GET').toUpperCase() === method && String(url).includes(r.match),
    );
    if (!route) throw new Error(`unstubbed fetch: ${method} ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    } as unknown as Response;
  });
}

/** Render the INTERNAL route (`/forms/:name`) over a raw authored section list. */
function renderInternal(sections: unknown[], type = 'simple') {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      {
        match: '/meta/view/',
        body: {
          name: 'ticket.edit',
          object: 'ticket',
          viewKind: 'form',
          label: 'Ticket',
          config: { type, sections },
        },
      },
      { match: '/meta/object/', body: TICKET },
    ]),
  );
  return render(
    <MemoryRouter initialEntries={['/forms/ticket.edit']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Render the PUBLIC route (`/f/:slug`) over a raw authored section list. */
function renderPublic(sections: unknown[]) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      {
        match: '/forms/ticket-intake',
        body: {
          slug: 'ticket-intake',
          object: 'ticket',
          label: 'Ticket intake',
          form: { type: 'simple', sections },
          objectSchema: TICKET,
        },
      },
    ]),
  );
  return render(
    <MemoryRouter initialEntries={['/f/ticket-intake']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Harness-kill leg. Fires in BOTH directions — zero anchors and duplicated
 * anchors — so neither a form that failed to load nor one drawn twice can be
 * read as a content result. Its message is unlike every content assertion in
 * this file on purpose: a harness death must never be counted as a defect
 * detection when the ablation legs below are classified.
 */
async function liveForm(): Promise<HTMLFormElement> {
  await waitFor(() => expect(screen.getByLabelText('Anchor Note')).toBeInTheDocument());
  const forms = document.body.querySelectorAll('form');
  if (forms.length !== 1) {
    throw new Error(`HARNESS DEAD 8641: expected exactly 1 form, found ${forms.length}`);
  }
  const anchors = forms[0].querySelectorAll('input[name="anchor_note"]');
  if (anchors.length !== 1) {
    throw new Error(`HARNESS DEAD 8641: expected exactly 1 anchor input, found ${anchors.length}`);
  }
  return forms[0] as HTMLFormElement;
}

/**
 * The rendered form's structure in document order: `H:<heading>` per section
 * (`H:-` when it has none) and `F:<name>` per control. Structural rather than
 * presence-based, because presence alone cannot see a resolver that gave every
 * section the same members.
 */
function outline(form: HTMLElement): string[] {
  const out: string[] = [];
  form.querySelectorAll('section').forEach((sec) => {
    const h = sec.querySelector('h2');
    out.push(`H:${h?.textContent ?? '-'}`);
    sec.querySelectorAll('input,textarea,select').forEach((el) => {
      out.push(`F:${(el as HTMLInputElement).name}`);
    });
  });
  return out;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── The premise ──────────────────────────────────────────────────────────

describe('objectui#8641 — the shape the console must accept', () => {
  it('PREMISE: `@objectstack/spec` ACCEPTS a bare { group } form section', () => {
    // Re-derived against the INSTALLED package rather than quoted from the
    // card: if the spec ever stopped accepting this shape, every leg below
    // would be pinning a shape no producer can author.
    const accepted = FormSectionSchema.safeParse({ group: 'contact_info' });
    expect(accepted.success).toBe(true);
    expect(accepted.data).toMatchObject({ group: 'contact_info' });

    // And it refuses the presentation keys the GROUP owns, which is why the
    // section arrives with no `label` for this renderer to draw.
    expect(FormSectionSchema.safeParse({ group: 'contact_info', label: 'X' }).success).toBe(false);
  });
});

// ─── The discriminating axis ──────────────────────────────────────────────

describe('objectui#8641 — a group-referencing section renders the members that group declares', () => {
  it('EACH_GROUP_SECTION_RENDERS_ITS_OWN_MEMBERS — buildSections, two DIFFERENT groups', () => {
    const sections = buildSections(
      formOf([ANCHOR, { group: 'billing' }, { group: 'contact_info' }]),
      TICKET as never,
    );

    expect(sections).toHaveLength(3);

    // ⭐ The SECOND declared group, asserted first — the leg a constant
    // resolution cannot satisfy. Concrete identifiers, in declared order.
    expect(sections[1].label).toBe('Billing Details');
    expect(sections[1].fields.map((f) => f.name)).toEqual(['invoice_no', 'po_number']);

    // The first declared group. Green under the caricature too, and kept
    // because "billing rendered SOMETHING" would otherwise be satisfied by a
    // resolver that hands every section the same list.
    expect(sections[2].label).toBe('Contact Info');
    expect(sections[2].fields.map((f) => f.name)).toEqual(['email', 'phone']);

    // The labels are the GROUP's, and the member rows carry the object's own
    // field metadata — so what is on screen is the derived section, not a
    // shell named after it.
    expect(sections[1].fields.map((f) => f.label)).toEqual(['Invoice No', 'PO Number']);
  });

  it('EACH_GROUP_SECTION_RENDERS_ITS_OWN_MEMBERS — internal /forms/:name route, in the DOM', async () => {
    renderInternal([ANCHOR, { group: 'billing' }, { group: 'contact_info' }]);
    const form = await liveForm();

    expect(outline(form)).toEqual([
      'H:Anchor', 'F:anchor_note',
      'H:Billing Details', 'F:invoice_no', 'F:po_number',
      'H:Contact Info', 'F:email', 'F:phone',
    ]);

    // The pre-fix DOM measurement, inverted: these controls were absent.
    expect(screen.getByLabelText('Invoice No')).toBeInTheDocument();
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
  });

  it('EACH_GROUP_SECTION_RENDERS_ITS_OWN_MEMBERS — public /f/:slug route, in the DOM', async () => {
    // The second loader, and NOT a duplicate of the one above: the internal
    // route rebuilds the object schema key by key (so `fieldGroups` has to be
    // copied there explicitly), while the public route forwards the server's
    // payload whole. One of them can regress without the other.
    renderPublic([ANCHOR, { group: 'billing' }, { group: 'contact_info' }]);
    const form = await liveForm();

    expect(outline(form)).toEqual([
      'H:Anchor', 'F:anchor_note',
      'H:Billing Details', 'F:invoice_no', 'F:po_number',
      'H:Contact Info', 'F:email', 'F:phone',
    ]);
  });

  it('carries the GROUP\'s presentation — collapse state comes from the derivation, not from here', () => {
    const sections = buildSections(formOf([ANCHOR, { group: 'archive' }]), TICKET as never);

    expect(sections[1].label).toBe('Archive');
    expect(sections[1].fields.map((f) => f.name)).toEqual(['old_ref']);
    // `collapse: 'collapsed'` on the object's `fieldGroups` entry, mapped onto
    // this renderer's boolean pair by the SHARED adapter. Nothing in this app
    // knows the `collapse` vocabulary.
    expect(sections[1].collapsible).toBe(true);
    expect(sections[1].collapsed).toBe(true);
  });

  it('the FORM keeps its own layout key beside `group`', () => {
    // `columns` is what THIS form does with the section, not what the group
    // declares, so the authored value wins — the spec's own precedence.
    const sections = buildSections(
      formOf([ANCHOR, { group: 'billing', columns: 3 }]),
      TICKET as never,
    );
    expect(sections[1].columns).toBe(3);
    expect(sections[1].fields.map((f) => f.name)).toEqual(['invoice_no', 'po_number']);
  });
});

// ─── Non-regression controls ──────────────────────────────────────────────

describe('objectui#8641 — what must NOT change', () => {
  it('CONTROL: a form with no group reference is built exactly as before', async () => {
    renderInternal([
      { label: 'Details', fields: ['channel', { field: 'email', label: 'Contact Email' }] },
      ANCHOR,
    ]);
    const form = await liveForm();

    expect(outline(form)).toEqual([
      'H:Details', 'F:channel', 'F:email',
      'H:Anchor', 'F:anchor_note',
    ]);
    // The field-level override still wins over the object's label.
    expect(screen.getByLabelText('Contact Email')).toBeInTheDocument();
  });

  it('CONTROL: enumerated and referenced sections coexist in AUTHORED order', () => {
    const sections = buildSections(
      formOf([{ label: 'Top', fields: ['channel'] }, { group: 'billing' }, ANCHOR]),
      TICKET as never,
    );
    expect(sections.map((s) => s.label)).toEqual(['Top', 'Billing Details', 'Anchor']);
    expect(sections.map((s) => s.fields.map((f) => f.name))).toEqual([
      ['channel'], ['invoice_no', 'po_number'], ['anchor_note'],
    ]);
  });
});

// ─── The other half of the defect: it reported nothing ────────────────────

describe('objectui#8641 — an unresolvable reference is REPORTED, not silent', () => {
  it('a group nothing declares renders empty and names itself, the object and the fix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sections = buildSections(
      formOf([ANCHOR, { group: 'no_such_group_8641' }]),
      TICKET as never,
    );

    expect(sections[1].fields).toEqual([]);
    const said = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said).toContain('no_such_group_8641');
    expect(said).toContain('ticket');
    expect(said).toContain('fieldGroups');
  });

  it('`group` on a wizard section is refused out loud — the same answer the spec door gives', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sections = buildSections(
      formOf([ANCHOR, { group: 'billing' }], 'wizard'),
      TICKET as never,
    );

    // Rendered empty rather than honoured: a field group carries `collapse`
    // and `visibleWhen`, and a wizard step has a slot for neither, so
    // `@objectstack/spec` refuses the combination at parse. This renderer
    // gives the refused shape the same answer instead of inventing semantics
    // the spec declined to give it.
    expect(sections[1].fields).toEqual([]);
    expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('wizard');
  });
});
