/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35437 — the record page's other surfaces honour a field's own
 * `visibleWhen` the way the form and the details body do.
 *
 * `@objectstack/spec` `Field.visibleWhen`: "field is shown only when TRUE
 * (else hidden)". The details body (`record:details`) applies it since
 * objectstack#35314, through `dropFieldPredicateHidden`
 * (`../fieldPredicateVisibility`). The surfaces pinned here drew the field on
 * every record before this card:
 *
 *  - the header highlights strip — `record:highlights`, drawn by
 *    `HeaderHighlight`;
 *  - the `detail-view` node — its body, its own highlights strip and its
 *    header summary chips;
 *  - the record drawer — `RecordDetailDrawer`, whose body is a `DetailView`.
 *
 * ## How "the way the form does" is measured, not asserted
 *
 * Every case renders the same row on every surface AND through the entry form
 * renderer (`@object-ui/components`' `form`, an edit form of that row, the
 * field carrying the same predicate). The assertion compares all of them with
 * the expected verdict at once, so two surfaces wrong the same way still turn
 * it red, and a red names the surface.
 *
 * ## The harness cannot read as a refusal
 *
 * Every render first finds an ungated anchor value (and the form its ungated
 * `Stage` control), and the two `DetailView` surfaces wait for their own
 * object-schema read to land. Each throws `HARNESS DEAD` otherwise, so a
 * surface that rendered nothing, or rendered before it knew the predicate,
 * can never pass a "hidden" leg.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import {
  RecordContextProvider,
  PredicateScopeProvider,
  SchemaRenderer,
  SchemaRendererProvider,
} from '@object-ui/react';
// Module-scope side-effect imports (objectui#3010): the registry must hold the
// entry form's `form` renderer and the `detail-view` node before a leg looks
// them up.
import '@object-ui/components';
import '@object-ui/fields';
import '../index';
import { RecordHighlightsRenderer } from '../renderers/record-highlights';
import { RecordDetailDrawer } from '../RecordDetailDrawer';
import { DetailView } from '../DetailView';

/* ─────────────────────────────────────────────────────────────────────────────
 * Fixture
 * ─────────────────────────────────────────────────────────────────────────── */

const OBJECT_NAME = 'qa_field_gate_surfaces';
const cel = (source: string) => ({ dialect: 'cel', source });

const WIN_LABEL = 'Win Reason';

/**
 * `win_reason` carries the predicate under test, `loss_reason` a fixed one
 * that holds on LOST, `next_step` none. `region` is the ungated anchor and
 * `name` the record's title, so no header title ladder reads a leg's value.
 */
const objectSchemaWith = (visibleWhen: unknown) => ({
  name: OBJECT_NAME,
  fields: {
    name: { type: 'text', label: 'Name' },
    region: { type: 'text', label: 'Region' },
    stage: { type: 'text', label: 'Stage' },
    // Declared, and carried by NO row: the null-seed case.
    tier: { type: 'text', label: 'Tier' },
    // A relation: these surfaces carry it expanded, the form its id.
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
    loss_reason: { type: 'text', label: 'Loss Reason', visibleWhen: "record.stage == 'closed_lost'" },
    win_reason: { type: 'text', label: WIN_LABEL, ...(visibleWhen !== undefined ? { visibleWhen } : {}) },
    next_step: { type: 'text', label: 'Next Step' },
  },
});

type Row = Record<string, any>;
const LOST: Row = {
  id: 'R1',
  name: 'Deal one',
  region: 'region-of-lost',
  stage: 'closed_lost',
  owner: { id: 'u1', name: 'Kim' },
  loss_reason: 'loss-of-lost',
  win_reason: 'win-of-lost',
  next_step: 'next-of-lost',
};
const WON: Row = {
  id: 'R2',
  name: 'Deal two',
  region: 'region-of-won',
  stage: 'closed_won',
  owner: { id: 'u2', name: 'Lee' },
  loss_reason: 'loss-of-won',
  win_reason: 'win-of-won',
  next_step: 'next-of-won',
};

/** The host scope `ExpressionProvider` mounts. */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, features: {} };
}

const textCount = (text: string): number => screen.queryAllByText(text).length;

/** A data source whose only read is the object schema the surface asks for. */
function dataSourceFor(objectSchema: Record<string, unknown>) {
  return { getObjectSchema: vi.fn().mockResolvedValue(objectSchema) } as any;
}

/* ── the surfaces ─────────────────────────────────────────────────────────── */

type Surface = 'highlights' | 'node' | 'nodeStrip' | 'drawer';
const SURFACES: Surface[] = ['highlights', 'node', 'nodeStrip', 'drawer'];

const STRIP_FIELDS = ['region', 'stage', 'loss_reason', 'win_reason', 'next_step'];

async function mountSurface(
  surface: Surface,
  row: Row,
  objectSchema: Record<string, unknown>,
  scope: Record<string, unknown>,
): Promise<void> {
  const ds = dataSourceFor(objectSchema);
  const wrap = (ui: React.ReactElement) => render(<PredicateScopeProvider scope={scope}>{ui}</PredicateScopeProvider>);
  if (surface === 'highlights') {
    wrap(
      <RecordContextProvider objectName={OBJECT_NAME} recordId={row.id} data={row} objectSchema={objectSchema}>
        <RecordHighlightsRenderer schema={{ fields: STRIP_FIELDS } as any} />
      </RecordContextProvider>,
    );
    return;
  }
  if (surface === 'node') {
    wrap(
      <SchemaRendererProvider dataSource={ds}>
        <SchemaRenderer
          schema={{
            type: 'detail-view',
            objectName: OBJECT_NAME,
            resourceId: row.id,
            data: row,
            showBack: false,
            // Field descriptors, as an authored `detail-view` writes them.
            sections: [{
              title: 'Body',
              fields: STRIP_FIELDS.map((name) => ({ name, label: (objectSchema.fields as any)[name].label })),
            }],
          } as never}
        />
      </SchemaRendererProvider>,
    );
  } else if (surface === 'nodeStrip') {
    // The node's own highlights strip, with nothing gated in its body.
    wrap(
      <DetailView
        dataSource={ds}
        schema={{
          type: 'detail-view',
          objectName: OBJECT_NAME,
          resourceId: row.id,
          data: row,
          showBack: false,
          fields: [{ name: 'region', label: 'Region' }],
          highlightFields: STRIP_FIELDS.filter((n) => n !== 'region').map((name) => ({ name })),
        } as any}
      />,
    );
  } else {
    wrap(
      <RecordDetailDrawer
        open
        onClose={() => {}}
        title="Deal"
        record={row}
        objectName={OBJECT_NAME}
        recordId={row.id}
        dataSource={ds}
        objectSchema={objectSchema as any}
      />,
    );
  }
  // A `DetailView` learns the predicate from its own object-schema read: wait
  // for it to land, so a "hidden" leg is never read off the pre-schema frame.
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT_NAME));
  await act(async () => {});
}

/**
 * Is `field` drawn on `surface` — label AND value? The field goes whole or
 * stays whole: a label without its value (or the reverse) is a defect of its
 * own, never a verdict.
 */
async function surfaceShows(
  surface: Surface,
  visibleWhen: unknown,
  row: Row,
  { scope = {}, field = 'win_reason', label = WIN_LABEL }: { scope?: Record<string, unknown>; field?: string; label?: string } = {},
): Promise<boolean> {
  await mountSurface(surface, row, objectSchemaWith(visibleWhen), scope);
  const anchor = textCount(row.region);
  if (anchor !== 1) {
    cleanup();
    throw new Error(`HARNESS DEAD on ${surface}: expected the ungated Region value once, found ${anchor}`);
  }
  const labels = textCount(label);
  const values = textCount(row[field]);
  cleanup();
  if (labels === 1 && values === 1) return true;
  if (labels === 0 && values === 0) return false;
  throw new Error(`PARTIAL FIELD on ${surface}: label ${labels}, value ${values}`);
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

/** Every surface's verdict on [LOST, WON], keyed by surface. */
async function surfaceVerdicts(
  visibleWhen: unknown,
  rows: [Row, Row],
  scopes: [Record<string, unknown>, Record<string, unknown>] = [{}, {}],
): Promise<Record<Surface, [boolean, boolean]>> {
  const out = {} as Record<Surface, [boolean, boolean]>;
  for (const s of SURFACES) {
    out[s] = [
      await surfaceShows(s, visibleWhen, rows[0], { scope: scopes[0] }),
      await surfaceShows(s, visibleWhen, rows[1], { scope: scopes[1] }),
    ];
  }
  return out;
}

const every = (v: [boolean, boolean]): Record<Surface, [boolean, boolean]> =>
  Object.fromEntries(SURFACES.map((s) => [s, v])) as Record<Surface, [boolean, boolean]>;

/* ── `useRecordEditable`'s explain probe — a router, not a sink ──────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';
let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  // A faulted predicate warns once per text on every surface — expected here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      fetchCalls.push(url);
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ record: { visible: true } }) };
    }),
  );
});

afterEach(() => {
  expect(fetchCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The parity matrix — every surface against the form
 * ═══════════════════════════════════════════════════════════════════════════ */

type Case = { label: string; visibleWhen: unknown; expected: [boolean, boolean] };

const MATRIX: Case[] = [
  { label: 'envelope `record.stage == closed_won` — the card reproduction; CONTROL: drawn where it holds', visibleWhen: cel("record.stage == 'closed_won'"), expected: [false, true] },
  { label: 'bare-string `record.stage == closed_won` — the same verdict as the envelope', visibleWhen: "record.stage == 'closed_won'", expected: [false, true] },
  { label: 'CONTROL — no predicate: the field is drawn on every row', visibleWhen: undefined, expected: [true, true] },
  { label: 'CONTROL — a parse error SHOWS the field (fail-open, ADR-0137 D3)', visibleWhen: cel('record.stage =='), expected: [true, true] },
  { label: 'CONTROL — a bare identifier is unbound and SHOWS the field (fail-open, ADR-0137 D3)', visibleWhen: "stage == 'closed_won'", expected: [true, true] },
  { label: 'a declared field the row does not carry compares as null — evaluated, not faulted', visibleWhen: cel("record.tier == 'gold'"), expected: [false, false] },
  { label: 'a relation binds as its stored id, expanded or not', visibleWhen: cel("record.owner == 'u2'"), expected: [false, true] },
  { label: '`previous` binds the persisted row, as on the record\'s edit form', visibleWhen: cel("previous.stage == 'closed_won'"), expected: [false, true] },
];

describe('the highlights strip, the detail-view node and the record drawer judge a field\'s visibleWhen as the form does (objectstack#35437)', () => {
  for (const c of MATRIX) {
    it(c.label, async () => {
      const form = [formShows(c.visibleWhen, LOST), formShows(c.visibleWhen, WON)];
      const surfaces = await surfaceVerdicts(c.visibleWhen, [LOST, WON]);
      expect({ form, ...surfaces }).toEqual({ form: c.expected, ...every(c.expected) });
    });
  }

  it('the host `current_user` scope binds on every surface', async () => {
    const gate = cel("'sales_manager' in current_user.positions");
    const denied = hostScope(['sales']);
    const allowed = hostScope(['sales_manager']);
    const form = [formShows(gate, WON, denied), formShows(gate, WON, allowed)];
    const surfaces = await surfaceVerdicts(gate, [WON, WON], [denied, allowed]);
    expect({ form, ...surfaces }).toEqual({ form: [false, true], ...every([false, true]) });
  });

  it('CONTROL — beside a hidden field, a field whose predicate holds and a field with none stay drawn', async () => {
    const gate = cel("record.stage == 'closed_won'");
    for (const s of SURFACES) {
      expect(await surfaceShows(s, gate, LOST, { field: 'loss_reason', label: 'Loss Reason' })).toBe(true);
      expect(await surfaceShows(s, gate, LOST, { field: 'next_step', label: 'Next Step' })).toBe(true);
      expect(await surfaceShows(s, gate, LOST)).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The detail-view node's header summary chips
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('the detail-view header draws no summary chip for a field its visibleWhen hides (objectstack#35437)', () => {
  async function chipShows(row: Row): Promise<boolean> {
    // `stage` is the chip the header picks on its own (a status-like field
    // with a value); here it is the gated field.
    const objectSchema = objectSchemaWith(undefined);
    (objectSchema.fields as Record<string, unknown>).stage = {
      type: 'text', label: 'Stage', visibleWhen: "record.region == 'region-of-won'",
    };
    await mountSurface('node', row, objectSchema, {});
    const header = document.querySelector('h1')?.parentElement;
    if (!header || !header.textContent?.includes(row.name)) {
      cleanup();
      throw new Error('HARNESS DEAD: the record title never drew');
    }
    const shown = Array.from(header.querySelectorAll('*')).some((el) => el.textContent === row.stage);
    cleanup();
    return shown;
  }

  it('a `stage` chip is drawn on WON and not on LOST', async () => {
    expect([await chipShows(LOST), await chipShows(WON)]).toEqual([false, true]);
  });
});
