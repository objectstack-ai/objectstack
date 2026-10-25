/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11630 — "The detail page evaluates `visibleWhen` per group exactly
 * as the form does."
 *
 * The reported shape: an object declares
 * `fieldGroups: [{ key: 'pro', visibleWhen: "record.kind == 'pro'" }]`. The
 * edit form hides the "Pro details" section on a `basic` row and shows it on a
 * `pro` row; the record detail page drew the section, header included, on
 * both. The synthesizer dropped the predicate, and `record:details` read none.
 *
 * ## The route: the spec's own `{ group }` reference
 *
 * `@objectstack/spec`'s `RecordDetailsProps.sections[]` refuses `visibleWhen`
 * on an enumerated section, and declares the `{ group }` reference, which
 * inherits the group's presentation, `visibleWhen` included. So the synthesized
 * default page (`buildDefaultDetails`) and app-shell's runtime default page
 * write `{ group: KEY }`, and `record:details` gates the reference it resolves.
 * An enumerated section's `visibleWhen` is NOT read — pinned below, because a
 * renderer that honours a key the protocol refuses is the trap this route
 * closes.
 *
 * ## How "exactly as the form does" is measured, not asserted
 *
 * Every predicate case below is rendered TWICE on the same row: once through
 * `record:details` (the body the synthesized default page builds, via
 * `buildDefaultDetails`), and once through the entry form renderer itself —
 * `@object-ui/components`' `form`, given the section-divider row
 * `plugin-form`'s `projectSectionDivider` emits for a field group (the
 * predicate, its fail-closed `visibleWhenFault: 'hidden'` stamp — objectui#13055 —
 * and the claim on the group's members), as an edit form of that
 * row (`defaultValues` and `previousValues`). Each leg asserts the form's
 * verdict, the detail page's verdict, AND the expected verdict, so two
 * surfaces that are wrong the same way still turn the leg red.
 *
 * The matrix covers what the form's evaluator does with a section predicate:
 * both spellings (bare string and `{ dialect: 'cel', source }` envelope), the
 * `record.` scoping (a bare identifier is unbound), a predicate that cannot be
 * evaluated (the form HIDES a field group's section — fail-closed, the
 * direction `@objectstack/spec` declares for this slot, objectui#13055), a
 * declared field the row
 * does not carry (seeded `null`, so it evaluates instead of faulting), a
 * relation that arrives expanded on this page and as its id on the form, the
 * `previous` root an edit form binds, and the host `current_user` scope.
 *
 * ## The harness cannot read as a refusal
 *
 * Each detail render navigates by {@link requireLiveDetail} — the ungated
 * "General" section, always drawn — and each form render by
 * {@link requireLiveForm}. Both throw a textually distinct `HARNESS DEAD`
 * first, so a body that rendered nothing at all can never pass a "hidden" leg.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { RecordContextProvider, PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect import (objectui#3010): the registry must hold the
// entry form's `form` renderer before the parity legs look it up.
import '@object-ui/components';
import { RecordDetailsRenderer, resetUnresolvedSectionGroupReports } from '../record-details';
import { buildDefaultDetails } from '../../synth/buildDefaultPageSchema';

/* ─────────────────────────────────────────────────────────────────────────────
 * Fixture — the card's reproduction, plus the columns the matrix needs.
 *
 * `name` is DECLARED and left UNSET on every row, so the page-H1 dedupe ladder
 * resolves to it, finds no value and hides no row these legs read (the
 * objectui#8175 trap, as in `record-details.sectionGroupAndLabels-8497`).
 * ─────────────────────────────────────────────────────────────────────────── */

const OBJECT_NAME = 'qa_group_gate4';
const cel = (source: string) => ({ dialect: 'cel', source });

const objectSchemaWith = (visibleWhen: unknown) => ({
  name: OBJECT_NAME,
  fields: {
    name: { type: 'text', label: 'Name' },
    kind: { type: 'text', label: 'Kind' },
    // Declared, and carried by NO row: the null-seed case.
    tier: { type: 'text', label: 'Tier' },
    // A relation: this page's record carries it expanded, the form its id.
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
    pro_a: { type: 'text', label: 'Pro A', group: 'pro' },
    pro_b: { type: 'text', label: 'Pro B', group: 'pro' },
    notes: { type: 'text', label: 'Notes', group: 'general' },
  },
  fieldGroups: [
    { key: 'general', label: 'General' },
    { key: 'pro', label: 'Pro details', ...(visibleWhen !== undefined ? { visibleWhen } : {}) },
  ],
});

type Row = Record<string, any>;
const BASIC: Row = {
  id: 'R1',
  kind: 'basic',
  owner: { id: 'u1', name: 'Kim' },
  pro_a: 'pro-a-of-basic',
  pro_b: 'pro-b-of-basic',
  notes: 'notes-of-basic',
};
const PRO: Row = {
  id: 'R2',
  kind: 'pro',
  owner: { id: 'u2', name: 'Lee' },
  pro_a: 'pro-a-of-pro',
  pro_b: 'pro-b-of-pro',
  notes: 'notes-of-pro',
};

/** The host scope `ExpressionProvider` mounts (see the form's `section-grouping-6236` pin). */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, features: {} };
}

const textCount = (text: string): number => screen.queryAllByText(text).length;

/* ── the two surfaces ─────────────────────────────────────────────────────── */

function renderDetails(
  schema: Record<string, unknown>,
  row: Row,
  objectSchema: Record<string, unknown>,
  scope: Record<string, unknown>,
) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <RecordContextProvider
        objectName={OBJECT_NAME}
        recordId={row.id}
        data={row}
        objectSchema={objectSchema}
      >
        <RecordDetailsRenderer schema={schema as any} />
      </RecordContextProvider>
    </PredicateScopeProvider>,
  );
}

const requireLiveDetail = (): void => {
  const anchor = textCount('General');
  if (anchor !== 1) {
    throw new Error(`HARNESS DEAD: expected the ungated "General" section heading once, found ${anchor}`);
  }
};

/** Is the gated group drawn on the detail page — heading AND members? */
function detailShowsPro(
  visibleWhen: unknown,
  row: Row,
  scope: Record<string, unknown> = {},
  schemaFor: (objectSchema: Record<string, unknown>) => Record<string, unknown> = (objectSchema) =>
    buildDefaultDetails(objectSchema as any).properties,
): boolean {
  const objectSchema = objectSchemaWith(visibleWhen);
  renderDetails(schemaFor(objectSchema), row, objectSchema, scope);
  requireLiveDetail();
  const heading = textCount('Pro details');
  const members = textCount(row.pro_a) + textCount(row.pro_b);
  cleanup();
  // The group goes whole or stays whole: a heading without its members (or
  // the reverse) is a defect of its own, never a verdict.
  if (heading === 1 && members === 2) return true;
  if (heading === 0 && members === 0) return false;
  throw new Error(`PARTIAL GROUP on the detail page: heading ${heading}, members ${members}`);
}

/**
 * The edit form for the same row, through the form renderer's own section
 * gate: the divider `projectSectionDivider` emits for a titled group, claiming
 * its members. The form reads its record WITHOUT `$expand`, so a relation is
 * its id there — the one place the two surfaces receive different payloads.
 */
function formShowsPro(visibleWhen: unknown, row: Row, scope: Record<string, unknown> = {}): boolean {
  const Form = ComponentRegistry.get('form')!;
  const values = { ...row, owner: row.owner?.id };
  render(
    <PredicateScopeProvider scope={scope}>
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          defaultValues: values,
          previousValues: values,
          fields: [
            { name: 'kind', label: 'Kind', type: 'input' },
            { name: 'tier', label: 'Tier', type: 'input' },
            { name: 'owner', label: 'Owner', type: 'input' },
            {
              name: '__section_pro',
              label: 'Pro details',
              type: 'section-divider',
              visibleWhen,
              // What `deriveFieldGroupSections` stamps beside a group's
              // predicate and `projectSectionDivider` carries (objectui#13055).
              ...(visibleWhen !== undefined ? { visibleWhenFault: 'hidden' } : {}),
              fields: ['pro_a', 'pro_b'],
              colSpan: 4,
            },
            { name: 'pro_a', label: 'Pro A', type: 'input' },
            { name: 'pro_b', label: 'Pro B', type: 'input' },
          ],
        }}
      />
    </PredicateScopeProvider>,
  );
  const anchor = screen.queryAllByLabelText(/^Kind/).length;
  if (anchor !== 1) {
    cleanup();
    throw new Error(`HARNESS DEAD: expected the ungated form field "Kind" once, found ${anchor}`);
  }
  const heading = textCount('Pro details');
  const members = screen.queryAllByLabelText(/^Pro [AB]/).length;
  cleanup();
  if (heading === 1 && members === 2) return true;
  if (heading === 0 && members === 0) return false;
  throw new Error(`PARTIAL GROUP on the form: heading ${heading}, members ${members}`);
}

/* ── `useRecordEditable`'s explain probe — a router, not a sink ──────────────
 * `DetailView` degrades to the GLOBAL `fetch` for the record-editability probe
 * when no host supplies one; under happy-dom that is a real HTTP client. Same
 * double as `record-details.sectionGroupAndLabels-8497`: any URL outside the
 * one route it serves fails `afterEach`.
 * ─────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';
let explainCalls: string[] = [];

beforeEach(() => {
  explainCalls = [];
  resetUnresolvedSectionGroupReports();
  // A faulted predicate warns once per text on both surfaces — expected here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      explainCalls.push(url);
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ record: { visible: true } }) };
    }),
  );
});

afterEach(() => {
  expect(explainCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The parity matrix
 * ═══════════════════════════════════════════════════════════════════════════ */

type Case = {
  label: string;
  visibleWhen: unknown;
  /** Expected verdict on [basic, pro]. */
  expected: [boolean, boolean];
};

const MATRIX: Case[] = [
  { label: 'envelope `record.kind == pro` — the card reproduction', visibleWhen: cel("record.kind == 'pro'"), expected: [false, true] },
  { label: 'bare-string `record.kind == pro` — the same verdict as the envelope', visibleWhen: "record.kind == 'pro'", expected: [false, true] },
  { label: 'no predicate — the control: the group is drawn on every row', visibleWhen: undefined, expected: [true, true] },
  { label: 'bare identifier `kind == pro` — values bind under `record.` only, so it is unbound and HIDES (fail-closed, objectui#13055)', visibleWhen: "kind == 'pro'", expected: [false, false] },
  { label: 'a parse error HIDES the section (fail-closed, objectui#13055)', visibleWhen: cel('record.kind =='), expected: [false, false] },
  { label: 'an unknown field HIDES the section (fail-closed, objectui#13055)', visibleWhen: cel("record.no_such_field == 'x'"), expected: [false, false] },
  { label: 'a declared field the row does not carry compares as null — evaluated, not faulted', visibleWhen: cel("record.tier == 'gold'"), expected: [false, false] },
  { label: 'a relation binds as its stored id, expanded or not', visibleWhen: cel("record.owner == 'u2'"), expected: [false, true] },
  { label: '`previous` binds the persisted row, as on the record\'s edit form', visibleWhen: cel("previous.kind == 'pro'"), expected: [false, true] },
];

describe('record:details evaluates a group\'s visibleWhen exactly as the form does (objectui#11630)', () => {
  for (const c of MATRIX) {
    it(c.label, () => {
      const detail = [detailShowsPro(c.visibleWhen, BASIC), detailShowsPro(c.visibleWhen, PRO)];
      const form = [formShowsPro(c.visibleWhen, BASIC), formShowsPro(c.visibleWhen, PRO)];
      expect({ form, detail }).toEqual({ form: c.expected, detail: c.expected });
    });
  }

  it('the host `current_user` scope binds on both surfaces', () => {
    const gate = cel("'sales_manager' in current_user.positions");
    const denied = hostScope(['sales']);
    const allowed = hostScope(['sales_manager']);
    const detail = [detailShowsPro(gate, PRO, denied), detailShowsPro(gate, PRO, allowed)];
    const form = [formShowsPro(gate, PRO, denied), formShowsPro(gate, PRO, allowed)];
    expect({ form, detail }).toEqual({ form: [false, true], detail: [false, true] });
  });
});

describe('an authored `{ group }` reference inherits the group\'s visibleWhen (objectui#11630)', () => {
  const byReference = () => ({ sections: [{ group: 'general' }, { group: 'pro', columns: 2 }] });
  // The shape app-shell's `RecordDetailView` writes for a declared group on the
  // runtime default page: the reference plus the Card chrome it lays out.
  const runtimeDefaultPage = () => ({
    sections: [{ group: 'general', showBorder: true }, { group: 'pro', showBorder: true }],
  });

  it('hidden on the basic row, drawn on the pro row — both spellings', () => {
    for (const visibleWhen of [cel("record.kind == 'pro'"), "record.kind == 'pro'"]) {
      expect([
        detailShowsPro(visibleWhen, BASIC, {}, byReference),
        detailShowsPro(visibleWhen, PRO, {}, byReference),
      ]).toEqual([false, true]);
    }
  });

  it('the runtime default page\'s `{ group, showBorder }` sections are gated the same way', () => {
    const gate = cel("record.kind == 'pro'");
    expect([
      detailShowsPro(gate, BASIC, {}, runtimeDefaultPage),
      detailShowsPro(gate, PRO, {}, runtimeDefaultPage),
    ]).toEqual([false, true]);
  });
});

describe('an ENUMERATED section\'s visibleWhen is not read (objectui#11630)', () => {
  it('a spec-refused `visibleWhen` on a hand-enumerated section gates nothing', () => {
    // The group itself declares no predicate here, so the only predicate on the
    // page is the one written on the enumerated entry — the key
    // `RecordDetailsProps.sections[]` refuses with `unrecognized_keys`.
    const enumerated = () => ({
      sections: [
        { group: 'general' },
        { name: 'pro', label: 'Pro details', fields: ['pro_a', 'pro_b'], visibleWhen: "record.kind == 'pro'" },
      ],
    });
    expect([
      detailShowsPro(undefined, BASIC, {}, enumerated),
      detailShowsPro(undefined, PRO, {}, enumerated),
    ]).toEqual([true, true]);
  });
});
