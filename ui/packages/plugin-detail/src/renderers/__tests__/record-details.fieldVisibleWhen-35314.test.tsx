/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35314 — "the default record page honours a field's `visibleWhen`
 * the same way the form does."
 *
 * The reported shape: a field declares an object-level `visibleWhen`
 * (`@objectstack/spec` `Field.visibleWhen`: "field is shown only when TRUE
 * (else hidden)"). The edit form hides it on a record where the predicate is
 * false; the synthesized default record page drew it, label and value, on
 * every record. `record:details` evaluated a field GROUP's `visibleWhen`
 * (objectui#11630) and no field's.
 *
 * ## How "the same way the form does" is measured, not asserted
 *
 * Every predicate case is rendered on the same row TWICE: once through
 * `record:details`, and once through the entry form renderer itself
 * (`@object-ui/components`' `form`, an edit form of that row, the field
 * carrying the predicate). Each leg asserts the form's verdict, the detail
 * page's verdict AND the expected verdict, so two surfaces wrong the same way
 * still turn it red.
 *
 * The fault direction is the field rule's, not the group's: a field
 * `visibleWhen` that cannot be evaluated SHOWS the field (ADR-0137 D3, the
 * form's `VISIBLE_WHEN_FAULTED`), where a group's hides the group
 * (objectui#13055, pinned in `record-details.groupVisibleWhen-11630`).
 *
 * ## The harness cannot read as a refusal
 *
 * Each detail render first finds the ungated `Region` value, and each form
 * render the ungated `Stage` control. Both throw a textually distinct
 * `HARNESS DEAD` first, so a body that rendered nothing at all can never pass
 * a "hidden" leg.
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
 * Fixture
 *
 * `name` is DECLARED and left UNSET on every row, so the page-H1 dedupe ladder
 * resolves to it, finds no value and hides no row these legs read (the
 * objectui#8175 trap, as in `record-details.groupVisibleWhen-11630`).
 * ─────────────────────────────────────────────────────────────────────────── */

const OBJECT_NAME = 'qa_field_gate';
const cel = (source: string) => ({ dialect: 'cel', source });

const WIN_LABEL = 'Win Reason';
const MEMO_LABEL = 'Memo';

/**
 * `win_reason` (in the `outcome` group) and `memo` (in no group — the trailing
 * ungrouped bucket) carry the predicate under test. `loss_reason` carries a
 * fixed one, and `next_step` none.
 */
const objectSchemaWith = (visibleWhen: unknown, withGroups = true) => ({
  name: OBJECT_NAME,
  fields: {
    name: { type: 'text', label: 'Name' },
    region: { type: 'text', label: 'Region', group: 'basics' },
    stage: { type: 'text', label: 'Stage', group: 'basics' },
    // Declared, and carried by NO row: the null-seed case.
    tier: { type: 'text', label: 'Tier', group: 'basics' },
    // A relation: this page's record carries it expanded, the form its id.
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user', group: 'basics' },
    loss_reason: {
      type: 'text', label: 'Loss Reason', group: 'outcome', visibleWhen: "record.stage == 'closed_lost'",
    },
    win_reason: {
      type: 'text', label: WIN_LABEL, group: 'outcome', ...(visibleWhen !== undefined ? { visibleWhen } : {}),
    },
    next_step: { type: 'text', label: 'Next Step', group: 'outcome' },
    memo: { type: 'text', label: MEMO_LABEL, ...(visibleWhen !== undefined ? { visibleWhen } : {}) },
  },
  ...(withGroups
    ? { fieldGroups: [{ key: 'basics', label: 'Basics' }, { key: 'outcome', label: 'Outcome' }] }
    : {}),
});

type Row = Record<string, any>;
const LOST: Row = {
  id: 'R1',
  region: 'region-of-lost',
  stage: 'closed_lost',
  owner: { id: 'u1', name: 'Kim' },
  loss_reason: 'loss-of-lost',
  win_reason: 'win-of-lost',
  next_step: 'next-of-lost',
  memo: 'memo-of-lost',
};
const WON: Row = {
  id: 'R2',
  region: 'region-of-won',
  stage: 'closed_won',
  owner: { id: 'u2', name: 'Lee' },
  loss_reason: 'loss-of-won',
  win_reason: 'win-of-won',
  next_step: 'next-of-won',
  memo: 'memo-of-won',
};

/** The host scope `ExpressionProvider` mounts (as in the group pin). */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, features: {} };
}

const textCount = (text: string): number => screen.queryAllByText(text).length;

/* ── the detail page's body shapes ────────────────────────────────────────── */

type SchemaFor = (objectSchema: Record<string, any>) => Record<string, unknown>;

/** The synthesized default page's Details body: `{ group }` references plus the ungrouped bucket's names. */
const synthesizedDefaultPage: SchemaFor = (objectSchema) => buildDefaultDetails(objectSchema as any).properties;

const descriptor = (objectSchema: Record<string, any>, name: string) => ({
  name,
  label: objectSchema.fields[name].label,
  type: objectSchema.fields[name].type,
});

/**
 * The shape app-shell's `RecordDetailView` hands the running default page
 * (`deriveRecordDetailSections`): each declared group as `{ group, showBorder }`
 * and the ungrouped bucket as an enumerated section of rich descriptors.
 */
const runtimeDefaultPage: SchemaFor = (objectSchema) => ({
  sections: [
    { group: 'basics', showBorder: true },
    { group: 'outcome', showBorder: true },
    { label: 'Other', showBorder: true, fields: [descriptor(objectSchema, 'memo')] },
  ],
});

/**
 * The running default page of an object with NO `fieldGroups`: app-shell's
 * primary/secondary split, one untitled enumerated section of descriptors.
 */
const runtimeDefaultPageUngrouped: SchemaFor = (objectSchema) => ({
  sections: [
    {
      showBorder: false,
      fields: ['region', 'stage', 'owner', 'loss_reason', 'win_reason', 'next_step', 'memo'].map((n) =>
        descriptor(objectSchema, n),
      ),
    },
  ],
});

/** An authored page: enumerated sections of bare names, the spec's spelling. */
const authoredSections: SchemaFor = () => ({
  sections: [
    { name: 'basics', label: 'Basics', fields: ['region', 'stage', 'owner'] },
    { name: 'outcome', label: 'Outcome', fields: ['loss_reason', 'win_reason', 'next_step', 'memo'] },
  ],
});

/** An authored page: a flat `fields` list. */
const authoredFields: SchemaFor = () => ({
  fields: ['region', 'stage', 'loss_reason', 'win_reason', 'next_step', 'memo'],
});

function renderDetails(schema: Record<string, unknown>, row: Row, objectSchema: Record<string, unknown>, scope: Record<string, unknown>) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <RecordContextProvider objectName={OBJECT_NAME} recordId={row.id} data={row} objectSchema={objectSchema}>
        <RecordDetailsRenderer schema={schema as any} />
      </RecordContextProvider>
    </PredicateScopeProvider>,
  );
}

/**
 * Is the gated field drawn on the detail page — label AND value? Returns the
 * verdict for `win_reason`, and for `memo` when `which` says so.
 */
function detailShows(
  visibleWhen: unknown,
  row: Row,
  {
    scope = {},
    schemaFor = synthesizedDefaultPage,
    withGroups = true,
    which = 'win_reason',
  }: { scope?: Record<string, unknown>; schemaFor?: SchemaFor; withGroups?: boolean; which?: 'win_reason' | 'memo' } = {},
): boolean {
  const objectSchema = objectSchemaWith(visibleWhen, withGroups);
  renderDetails(schemaFor(objectSchema), row, objectSchema, scope);
  const anchor = textCount(row.region);
  if (anchor !== 1) {
    cleanup();
    throw new Error(`HARNESS DEAD: expected the ungated Region value once, found ${anchor}`);
  }
  const label = textCount(which === 'win_reason' ? WIN_LABEL : MEMO_LABEL);
  const value = textCount(row[which]);
  cleanup();
  // The field goes whole or stays whole: a label without its value (or the
  // reverse) is a defect of its own, never a verdict.
  if (label === 1 && value === 1) return true;
  if (label === 0 && value === 0) return false;
  throw new Error(`PARTIAL FIELD on the detail page: label ${label}, value ${value}`);
}

/** The edit form for the same row, the field carrying the same predicate. */
function formShows(visibleWhen: unknown, row: Row, scope: Record<string, unknown> = {}): boolean {
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
            { name: 'stage', label: 'Stage', type: 'input' },
            { name: 'tier', label: 'Tier', type: 'input' },
            { name: 'owner', label: 'Owner', type: 'input' },
            { name: 'win_reason', label: WIN_LABEL, type: 'input', ...(visibleWhen !== undefined ? { visibleWhen } : {}) },
          ],
        }}
      />
    </PredicateScopeProvider>,
  );
  const anchor = screen.queryAllByLabelText(/^Stage/).length;
  if (anchor !== 1) {
    cleanup();
    throw new Error(`HARNESS DEAD: expected the ungated form field "Stage" once, found ${anchor}`);
  }
  const shown = screen.queryAllByLabelText(new RegExp(`^${WIN_LABEL}`)).length;
  cleanup();
  if (shown === 1) return true;
  if (shown === 0) return false;
  throw new Error(`form drew "${WIN_LABEL}" ${shown} times`);
}

/* ── `useRecordEditable`'s explain probe — a router, not a sink ──────────────
 * Same double as `record-details.groupVisibleWhen-11630`: any URL outside the
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
 * The parity matrix — the synthesized default page against the form
 * ═══════════════════════════════════════════════════════════════════════════ */

type Case = {
  label: string;
  visibleWhen: unknown;
  /** Expected verdict on [LOST, WON]. */
  expected: [boolean, boolean];
};

const MATRIX: Case[] = [
  { label: 'envelope `record.stage == closed_won` — the card reproduction', visibleWhen: cel("record.stage == 'closed_won'"), expected: [false, true] },
  { label: 'bare-string `record.stage == closed_won` — the same verdict as the envelope', visibleWhen: "record.stage == 'closed_won'", expected: [false, true] },
  { label: 'no predicate — the control: the field is drawn on every row', visibleWhen: undefined, expected: [true, true] },
  { label: 'bare identifier `stage == closed_won` is unbound and SHOWS the field (fail-open, ADR-0137 D3)', visibleWhen: "stage == 'closed_won'", expected: [true, true] },
  { label: 'a parse error SHOWS the field (fail-open, ADR-0137 D3)', visibleWhen: cel('record.stage =='), expected: [true, true] },
  { label: 'an unknown field SHOWS the field (fail-open, ADR-0137 D3)', visibleWhen: cel("record.no_such_field == 'x'"), expected: [true, true] },
  { label: 'a declared field the row does not carry compares as null — evaluated, not faulted', visibleWhen: cel("record.tier == 'gold'"), expected: [false, false] },
  { label: 'a relation binds as its stored id, expanded or not', visibleWhen: cel("record.owner == 'u2'"), expected: [false, true] },
  { label: '`previous` binds the persisted row, as on the record\'s edit form', visibleWhen: cel("previous.stage == 'closed_won'"), expected: [false, true] },
];

describe('record:details evaluates a field\'s visibleWhen exactly as the form does (objectstack#35314)', () => {
  for (const c of MATRIX) {
    it(c.label, () => {
      const detail = [detailShows(c.visibleWhen, LOST), detailShows(c.visibleWhen, WON)];
      const form = [formShows(c.visibleWhen, LOST), formShows(c.visibleWhen, WON)];
      expect({ form, detail }).toEqual({ form: c.expected, detail: c.expected });
    });
  }

  it('the host `current_user` scope binds on both surfaces', () => {
    const gate = cel("'sales_manager' in current_user.positions");
    const denied = hostScope(['sales']);
    const allowed = hostScope(['sales_manager']);
    const detail = [detailShows(gate, WON, { scope: denied }), detailShows(gate, WON, { scope: allowed })];
    const form = [formShows(gate, WON, denied), formShows(gate, WON, allowed)];
    expect({ form, detail }).toEqual({ form: [false, true], detail: [false, true] });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Every body the default record page is drawn from, and the authored ones
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('every record:details body draws a field only where its visibleWhen admits it (objectstack#35314)', () => {
  const gate = cel("record.stage == 'closed_won'");
  const bodies: Array<{ body: string; schemaFor: SchemaFor; withGroups?: boolean; which?: 'win_reason' | 'memo' }> = [
    { body: 'synthesized default page — a field in a declared group', schemaFor: synthesizedDefaultPage },
    { body: 'synthesized default page — a field in the ungrouped bucket', schemaFor: synthesizedDefaultPage, which: 'memo' },
    { body: 'running default page — a field in a declared group', schemaFor: runtimeDefaultPage },
    { body: 'running default page — a field in the ungrouped bucket', schemaFor: runtimeDefaultPage, which: 'memo' },
    { body: 'running default page of an object with no fieldGroups', schemaFor: runtimeDefaultPageUngrouped, withGroups: false },
    { body: 'authored page — enumerated sections of bare names', schemaFor: authoredSections },
    { body: 'authored page — a flat fields list', schemaFor: authoredFields },
  ];

  for (const b of bodies) {
    it(`${b.body}: hidden on LOST, drawn on WON`, () => {
      const opts = { schemaFor: b.schemaFor, withGroups: b.withGroups ?? true, which: b.which ?? 'win_reason' };
      expect([detailShows(gate, LOST, opts), detailShows(gate, WON, opts)]).toEqual([false, true]);
    });
  }

  it('CONTROL — a field whose predicate holds and a field with none are drawn on the default page', () => {
    const objectSchema = objectSchemaWith(gate);
    renderDetails(synthesizedDefaultPage(objectSchema), LOST, objectSchema, {});
    expect(textCount(LOST.region)).toBe(1);
    // `loss_reason`'s own predicate holds on LOST.
    expect([textCount('Loss Reason'), textCount(LOST.loss_reason)]).toEqual([1, 1]);
    // `next_step` declares none.
    expect([textCount('Next Step'), textCount(LOST.next_step)]).toEqual([1, 1]);
  });

  it('a section every member of which the predicates hide draws no heading', () => {
    const objectSchema = {
      ...objectSchemaWith(gate),
      fields: {
        ...objectSchemaWith(gate).fields,
        loss_reason: { type: 'text', label: 'Loss Reason', group: 'outcome', visibleWhen: "record.stage == 'closed_won'" },
        next_step: { type: 'text', label: 'Next Step', group: 'outcome', visibleWhen: "record.stage == 'closed_won'" },
      },
    };
    renderDetails(synthesizedDefaultPage(objectSchema), LOST, objectSchema, {});
    expect(textCount(LOST.region)).toBe(1);
    expect(textCount('Outcome')).toBe(0);
    cleanup();
    renderDetails(synthesizedDefaultPage(objectSchema), WON, objectSchema, {});
    expect(textCount('Outcome')).toBe(1);
  });
});
