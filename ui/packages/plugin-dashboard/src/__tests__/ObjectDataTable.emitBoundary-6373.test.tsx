/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The PRODUCER half of `declared = enforced` for the `data-table` columns slot
 * (objectui#6373). `table-declared-equals-enforced.test.tsx` in
 * `@object-ui/components` is the consumer-side twin: it derives what a renderer
 * READS and compares it against what the slot declares. This file asks the same
 * question from the other end — what does a producer WRITE?
 *
 * `ObjectDataTable.enrich()` returned `NormalizedColumn` (`[key: string]: any`),
 * so nothing checked its output against `DataTableSchema.columns: TableColumn[]`.
 * `{ ...col, ...fieldMeta }` wrote seven keys `TableColumn` does not declare:
 * `name`, `label`, `options`, `referenceTo`, `format`, `currency`, `decimals`.
 *
 * ## Why this file is a runtime census and not only a type
 *
 * ⚠️ The obvious remedy — annotate the return `TableColumn` — is BLIND to this
 * defect, measured on this program before the fix was written: TypeScript's
 * excess-property check is a freshness check on the properties a literal writes
 * OUT, and properties arriving through a spread are exempt. `{ ...col,
 * ...fieldMeta }` type-checks clean against `TableColumn`. The seam's type
 * (`EnrichedColumn`) closes that with ADR-0049 `?: never` tombstones, which bite
 * by assignability instead — both directives at the bottom of this file pin that,
 * and `tsc -p tsconfig.test.json` (chained from this package's `type-check`) is
 * what checks them.
 *
 * The census below is the half a type cannot express at all: it reads the keys
 * of the objects the widget actually hands over at run time, so a future spread,
 * a computed write, or an `as any` detour is caught by what LANDED rather than
 * by what was declared.
 *
 * ## The declared set is derived, never listed here
 *
 * `TableColumnSchema` (`@object-ui/types/zod`) is `TableColumn`'s hand-written
 * mirror, and `zod-mirror-parity.test.ts` keeps the two in step. Reading its
 * `.shape` is therefore reading the declaration, with no key list in this file to
 * drift. A key list is the artefact this defect class keeps producing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { TableColumnSchema } from '@object-ui/types/zod';
// The REAL renderers, imported at module scope (never behind a lazy boundary
// inside a bounded test window — AGENTS.md §测试纪律). `@object-ui/components`
// registers `data-table` as an import side effect.
import '@object-ui/components';

/** Every column list this widget handed to `data-table`, newest last. */
const emitted: any[][] = [];

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    // Capture AND delegate to the REAL registered renderer. A stand-in would
    // let a key look harmless because the stand-in never needed it; the point
    // of rendering through the real consumer is that the census and the
    // rendering are measured on the same objects.
    SchemaRenderer: ({ schema }: any) => {
      if (schema?.type === 'data-table') emitted.push(schema.columns ?? []);
      const Cmp = ComponentRegistry.get(schema.type) as any;
      if (!Cmp) throw new Error(`${schema.type} not registered`);
      return <Cmp schema={schema} />;
    },
    useDataScope: () => undefined,
    SchemaRendererContext: actual.SchemaRendererContext,
  };
});

import { ObjectDataTable } from '../ObjectDataTable';
import type { EnrichedColumn } from '../ObjectDataTable';
import type { FieldMeta } from '../recordFields';

/* ── the declared set, read off the mirror ───────────────────────────────── */

/** zod 4 one-hop shape read, the spelling `table-declared-equals-enforced` uses. */
function shapeOf(schema: unknown): Record<string, unknown> {
  const carrier = schema as { shape?: unknown; _def?: { shape?: unknown } };
  const shape = carrier?.shape ?? carrier?._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
  return (resolved ?? {}) as Record<string, unknown>;
}

const DECLARED = new Set(Object.keys(shapeOf(TableColumnSchema)));

/**
 * The one key this producer writes that `TableColumn` does not declare, and the
 * one it is allowed to: `data-table` reads `col.accessorKey || col.name`, and
 * objectui#5120 HOLDS that alias — two published skill guides still teach a
 * `data-table` column spelled `{ name, label }`. Retiring it is #5120's step,
 * not this file's.
 */
const HELD_ALIAS = 'name';

/**
 * Retired from the emit by objectui#6373 — this producer SOURCES none of them
 * from `fieldMeta`. Listed here as the card's VERDICTS, not as the census's
 * input: the census above is derived, and these names are what the verdict
 * table in the PR body has to stay true to.
 *
 * objectui#6425's ruling (maintainer, 2026-08-27) later split the six by
 * DECLARATION status without changing the emit: three are now declared on
 * `TableColumn` itself (an authored value passes through `{ ...col }` as
 * declared metadata; the producer still never writes them out of
 * `fieldMeta`), three remain undeclared (`decimals` retired outright,
 * `referenceTo` held for objectui#6597 at the time this ruling landed — that
 * card has since measured no authoring story and retired it too, the same
 * verdict as `decimals` — `label` objectui#5351's). The EMIT verdict for all
 * three was already "retired" either way, so this array is unchanged by
 * either later card: `decimals` and `referenceTo` moving from HELD/adjudicated
 * to fully RETIRED `FieldMeta` members doesn't touch what this producer WRITES
 * — it never wrote either from `fieldMeta` in the first place.
 */
const RETIRED_FROM_EMIT_UNDECLARED = ['label', 'referenceTo', 'decimals'] as const;
const RETIRED_FROM_EMIT_DECLARED = ['options', 'format', 'currency'] as const;
const RETIRED = [...RETIRED_FROM_EMIT_UNDECLARED, ...RETIRED_FROM_EMIT_DECLARED];

/* ── fixtures ────────────────────────────────────────────────────────────── */

const accountSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: {
      type: 'select',
      label: 'Industry',
      options: [
        { value: 'tech', label: 'Technology', color: 'blue' },
        { value: 'finance', label: 'Finance', color: 'green' },
      ],
    },
    amount: { type: 'currency', label: 'Amount', currency: 'USD', scale: 2 },
    // Canonical spec spelling (`reference`, not the retired `referenceTo` —
    // objectui#6597) — this field's `type: 'lookup'` is what drives
    // `computeLookupExpand` and the render below; `reference` documents the
    // target for a reader, but nothing in this package's `FieldMeta` pipeline
    // consumes it (retired end to end by this card).
    owner: { type: 'lookup', label: 'Owner', reference: 'user' },
  },
};

const ROWS = [{ name: 'Acme', industry: 'tech', amount: 1500, owner: { id: 'u1', name: 'Ada' } }];

function makeDataSource() {
  return { find: async () => ({ data: ROWS }), getObjectSchema: async () => accountSchema };
}

/**
 * Render and wait until the widget has handed a column list to `data-table`.
 *
 * The wait is on the emit itself, not on any rendered text: the widget returns
 * its empty state WITHOUT reaching `SchemaRenderer` while the fetch is in
 * flight, so an emit having happened already means the rows arrived. Waiting on
 * a particular cell's text instead would silently constrain every caller to a
 * column list that contains that cell.
 */
async function emit(schema: Record<string, unknown>): Promise<any[]> {
  emitted.length = 0;
  render(<ObjectDataTable schema={schema as any} dataSource={makeDataSource()} />);
  await waitFor(() => expect(emitted.length).toBeGreaterThan(0), { timeout: 2000 });
  const last = emitted[emitted.length - 1];
  expect(last, 'the widget never emitted a data-table column list').toBeTruthy();
  return last!;
}

afterEach(() => {
  cleanup();
  emitted.length = 0;
});

/* ── the instrument's own premises ───────────────────────────────────────── */

describe('the census reads a real declaration (#6373)', () => {
  it('resolves the mirror shape', () => {
    // Without this, a `.shape` read that silently answered `{}` would make
    // "none of the retired keys is declared" pass for the wrong reason while
    // the real assertion below failed for a misleading one.
    expect(DECLARED.size).toBeGreaterThan(5);
    expect(DECLARED.has('accessorKey')).toBe(true);
    expect(DECLARED.has('type')).toBe(true);
  });

  it('is measuring the slot as it stands after the #6425 ruling', () => {
    // This premise used to assert the slot declares NONE of the six — the
    // emit verdicts were "retire" because nothing declared them. The ruling
    // took the rule's other branch for three (declared on `TableColumn`), so
    // the premise now pins the SPLIT: the emit census below is unchanged
    // either way, because this producer writes none of the six from
    // `fieldMeta` — declared or not.
    for (const key of RETIRED_FROM_EMIT_UNDECLARED) expect(DECLARED.has(key)).toBe(false);
    for (const key of RETIRED_FROM_EMIT_DECLARED) expect(DECLARED.has(key)).toBe(true);
    expect(DECLARED.has(HELD_ALIAS)).toBe(false);
  });
});

/* ── the census ──────────────────────────────────────────────────────────── */

describe('ObjectDataTable emits only what the columns slot declares (#6373)', () => {
  it('auto-derived columns carry no undeclared key but the held alias', async () => {
    // Auto-derive: the author supplied no columns, so EVERY key on these
    // objects was written by `enrich`. That makes the census exact rather than
    // "the author's keys plus ours".
    const cols = await emit({ type: 'object-data-table', objectName: 'account' });
    expect(cols.length).toBeGreaterThan(0);

    const allowed = new Set([...DECLARED, HELD_ALIAS]);
    for (const col of cols) {
      const undeclared = Object.keys(col).filter((k) => !allowed.has(k));
      expect(undeclared, `column ${col.accessorKey} wrote undeclared keys`).toEqual([]);
    }
  });

  it('names the six keys that retired, and keeps the one that is held', async () => {
    const cols = await emit({ type: 'object-data-table', objectName: 'account' });
    for (const col of cols) {
      // `Object.keys`, not a value read: `buildFieldMeta` returns all of its
      // members unconditionally, so before this card every one of these keys
      // EXISTED on every emitted column — carrying `undefined` where the schema
      // said nothing, which is its own small lie about the shape. (It returned
      // eight originally, seven after objectui#6625 retired `decimals` from
      // `FieldMeta` itself, and returns six now: objectui#6597 retired
      // `referenceTo` from `FieldMeta` the same way. Neither key can be
      // written from here even by accident any more. The verdict below is
      // unchanged — both were already retired from the EMIT by this card.)
      for (const key of RETIRED) {
        expect(Object.keys(col), `${col.accessorKey}.${key}`).not.toContain(key);
      }
      // #5120's alias, byte for byte what the spread used to write.
      expect(col.name).toBe(col.accessorKey);
    }
  });

  it('still renders every retired value, through the cell closure', async () => {
    // The load-bearing half of the retirement rule: a key is inert only if its
    // VALUE still reaches its consumer by another road. Here that road is the
    // `FieldMeta` the `cell` closure captures. `options` is the visible proof —
    // the select label resolves to the option's label, from the object schema,
    // with `options` no longer on the column at all.
    await emit({ type: 'object-data-table', objectName: 'account' });
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.queryByText('tech')).not.toBeInTheDocument();
    // The lookup road: the expanded record renders its display name, not the
    // raw FK id. Note this does NOT exercise `referenceTo` — retired end to
    // end by objectui#6597, and never read on this path even before the
    // retirement (`ObjectDataTable.overrideSource-6425.test.tsx` measured
    // that). `computeLookupExpand` expands `owner` off the schema field's
    // `type: 'lookup'` alone, and the value arrives pre-expanded as
    // `{ id, name }`; `resolveLookupRecordName` falls back to
    // `pickRecordDisplayName`'s generic `.name`/`.title` heuristic when no
    // `refSchema` is available (`useRefObjectSchema(referenceTo)` needs the
    // reference target, which this producer never supplies) — no
    // `reference_to` / `reference` needed for that fallback to resolve `Ada`.
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.queryByText('u1')).not.toBeInTheDocument();
  });

  it('does not strip keys the AUTHOR spelled — retirement is about what the producer writes', async () => {
    // `normalizeColumns` states the rule this pins: "the authored spelling is
    // left in place, so a host reading `field` / `name` back off these columns
    // keeps working". `enrich` retiring its own writes must not reach through
    // and delete the author's. It also must not ADD anything new on this path.
    const authored = { accessorKey: 'amount', header: 'Amount', format: '$0,0', currency: 'EUR', field: 'amount' };
    const cols = await emit({ type: 'object-data-table', objectName: 'account', columns: [authored] });
    const col = cols[0];
    expect(col.format).toBe('$0,0');
    expect(col.currency).toBe('EUR');
    expect(col.field).toBe('amount');

    const allowed = new Set([...DECLARED, HELD_ALIAS, ...Object.keys(authored)]);
    expect(Object.keys(col).filter((k) => !allowed.has(k))).toEqual([]);
  });
});

/* ── the type-level half ─────────────────────────────────────────────────── */

describe("the emit type can FAIL — otherwise the annotation is decoration (#6373)", () => {
  it('accepts exactly what the producer emits', () => {
    // The positive control. Without it the two directives below could be
    // satisfied by a type that refuses everything, which would pin nothing.
    const accepted: EnrichedColumn = {
      header: 'Amount',
      accessorKey: 'amount',
      name: 'amount',
      type: 'currency',
      align: 'right',
      cell: (value: any) => value,
      // Authored passthrough of the #6425-DECLARED trio: `{ ...col }` may
      // legitimately carry these now — they are `TableColumn` members, no
      // longer tombstones on this emit type.
      format: '$0,0',
      currency: 'EUR',
      options: [{ value: 'tech', label: 'Technology' }],
    };
    expect(accepted.accessorKey).toBe('amount');
  });

  it('refuses a whole FieldMeta spread — the defect this card is about', () => {
    // Checked by `tsc -p tsconfig.test.json`, which this package's `type-check`
    // script chains and CI's Type Check job runs. A directive whose error stops
    // happening is reported UNUSED (TS2578), so these cannot decay into
    // decoration the way an uncompiled tombstone would.
    // @ts-expect-error objectui#6373 — re-adding `{ ...fieldMeta }` at the emit seam is a compile error.
    const spreadRefused: EnrichedColumn = { header: 'h', accessorKey: 'a', ...({} as FieldMeta) };
    expect(spreadRefused.accessorKey).toBe('a');
  });

  it('refuses the retired members even when nothing else about them is wrong', () => {
    // ⚠️ MEASURED, and the reason this second spread pin exists. The one above
    // is refused for TWO independent reasons: the tombstones, AND `FieldMeta`'s
    // `type?: string` not fitting the `TableColumnType` union objectui#5853
    // narrowed this key to. Deleting the tombstones therefore leaves it erroring
    // — so on its own it pins "the spread is refused" without pinning WHY, and
    // would have gone on passing after the enforcement was removed.
    //
    // `Omit<FieldMeta, 'name' | 'type'>` spans the retired members: `name` is
    // the held alias, `type` carries #5853's own refusal. Since the #6425
    // ruling declared `format` / `options` / `currency` on `TableColumn`, the
    // member still refused by the DERIVED tombstone is `label` alone —
    // enough to keep this spread an error, and nothing but the tombstone
    // refuses it. (`decimals` and `referenceTo` used to widen this list too;
    // objectui#6625 and objectui#6597 each retired the `FieldMeta` member, so
    // neither is spanned by this `Omit` at all any more — `FieldMeta` itself
    // no longer declares them. Their own refusals are pinned separately below,
    // because hand-written tombstones are now what carry them.)
    // @ts-expect-error objectui#6373 — the still-tombstoned member is refused by the tombstone alone.
    const retiredRefused: EnrichedColumn = { header: 'h', accessorKey: 'a', ...({} as Omit<FieldMeta, 'name' | 'type'>) };
    expect(retiredRefused.accessorKey).toBe('a');
  });

  it('refuses a retired key written out by hand', () => {
    // Kept because a hand-written property is the OTHER way a key gets added
    // back, and separated from the spread pins because the two are enforced
    // by different machinery. This pin carried `format` until the #6425
    // ruling declared it (writing it by hand is now legal, see the accepted
    // fixture above); `decimals` — the key the same ruling RETIRED — takes
    // its place.
    //
    // ⚠️ The source is a VARIABLE, not a fresh object literal, and that is
    // objectui#6625's doing rather than style. A fresh literal is refused by
    // the excess-property check whether or not any tombstone exists, so as a
    // literal this pinned "something refused this" without pinning what — and
    // it would have gone on passing after #6625 removed `decimals` from
    // `FieldMeta` and thus from the DERIVED tombstone band, which is a pin
    // passing because its subject stopped existing. A non-fresh source skips
    // the freshness check and reaches
    // `ObjectDataTableRetiredDecimalsTombstone` and nothing else. The control
    // below proves that is what answers.
    const carriesDecimals: { header: string; accessorKey: string; decimals?: number } =
      { header: 'h', accessorKey: 'a', decimals: 2 };
    // @ts-expect-error objectui#6373/#6425/#6625 — `decimals` refused by the explicit retired-key tombstone.
    const writtenRefused: EnrichedColumn = carriesDecimals;
    expect(writtenRefused.accessorKey).toBe('a');

    // objectui#6597's sibling pin, same shape: `referenceTo` was HELD (via
    // `ObjectDataTableColumnHolds`) at the time this file's `decimals` pin was
    // written, so it could not carry a tombstone yet. It measured no
    // authoring story and retired the `FieldMeta` member too, so it now needs
    // the identical hand-written-source treatment `decimals` gets above.
    const carriesReferenceTo: { header: string; accessorKey: string; referenceTo?: unknown } =
      { header: 'h', accessorKey: 'a', referenceTo: 'account' };
    // @ts-expect-error objectui#6373/#6597 — `referenceTo` refused by the explicit retired-key tombstone.
    const referenceToWrittenRefused: EnrichedColumn = carriesReferenceTo;
    expect(referenceToWrittenRefused.accessorKey).toBe('a');

    // objectui#11070 round 4's sibling pin, same shape: `reference_to` was a
    // `FieldMeta` member (objectui#6694), so the DERIVED tombstone band
    // refused it; the round retired the member, and the hand-written
    // `ObjectDataTableRetiredReferenceToSnakeTombstone` carries it now.
    const carriesReferenceToSnake: { header: string; accessorKey: string; reference_to?: unknown } =
      { header: 'h', accessorKey: 'a', reference_to: 'account' };
    // @ts-expect-error objectui#6694/#11070 — `reference_to` refused by the explicit retired-key tombstone.
    const referenceToSnakeWrittenRefused: EnrichedColumn = carriesReferenceToSnake;
    expect(referenceToSnakeWrittenRefused.accessorKey).toBe('a');

    // objectui#11070's text-family round, same shape again: `display_field`
    // was a `FieldMeta` member (objectui#6694), so the DERIVED band refused
    // it; the round retired the member (the cell reads `displayField`), and
    // the hand-written `ObjectDataTableRetiredDisplayFieldSnakeTombstone`
    // carries it now.
    const carriesDisplayFieldSnake: { header: string; accessorKey: string; display_field?: unknown } =
      { header: 'h', accessorKey: 'a', display_field: 'code' };
    // @ts-expect-error objectui#6694/#11070 — `display_field` refused by the explicit retired-key tombstone.
    const displayFieldSnakeWrittenRefused: EnrichedColumn = carriesDisplayFieldSnake;
    expect(displayFieldSnakeWrittenRefused.accessorKey).toBe('a');
  });

  it('the TOMBSTONE is what refuses the retired `display_field` at this emit (objectui#11070 text-family round)', () => {
    // Counter-control for the pin above: `EnrichedColumn` minus that tombstone
    // and nothing else ACCEPTS the source the directive refuses.
    const carriesDisplayFieldSnake: { header: string; accessorKey: string; display_field?: unknown } =
      { header: 'h', accessorKey: 'a', display_field: 'code' };
    const untombstoned: Omit<EnrichedColumn, 'display_field'> = carriesDisplayFieldSnake;
    expect(untombstoned.accessorKey).toBe('a');
  });

  it('the TOMBSTONE is what refuses the retired `reference_to` at this emit (objectui#11070 round 4)', () => {
    // Counter-control for the pin above: `EnrichedColumn` minus that tombstone
    // and nothing else ACCEPTS the source the directive refuses.
    const carriesReferenceToSnake: { header: string; accessorKey: string; reference_to?: unknown } =
      { header: 'h', accessorKey: 'a', reference_to: 'account' };
    const untombstoned: Omit<EnrichedColumn, 'reference_to'> = carriesReferenceToSnake;
    expect(untombstoned.accessorKey).toBe('a');
  });

  it('the TOMBSTONE is what refuses the retired `decimals` at this emit', () => {
    // ⭐ objectui#6625's counter-control for the pin above: `EnrichedColumn`
    // minus the retired-key tombstone and nothing else ACCEPTS the very source
    // the directive refuses. So the refusal is the tombstone's — not the
    // derived band's (which no longer reaches `decimals`, since the key left
    // `keyof FieldMeta`), not the excess-property check's (the source is not
    // fresh), and not weak-type detection's (`header` / `accessorKey` are in
    // common, and both are required here).
    const carriesDecimals: { header: string; accessorKey: string; decimals?: number } =
      { header: 'h', accessorKey: 'a', decimals: 2 };
    const untombstoned: Omit<EnrichedColumn, 'decimals'> = carriesDecimals;
    expect(untombstoned.accessorKey).toBe('a');
  });

  it('the TOMBSTONE is what refuses the retired `referenceTo` at this emit', () => {
    // ⭐ objectui#6597's counter-control, built the same way as `decimals`'s
    // above. `EnrichedColumn` minus the retired-key tombstone and nothing else
    // ACCEPTS the very source the directive refuses — so the refusal is the
    // tombstone's, not the derived band's (which no longer reaches
    // `referenceTo`, since the key left `keyof FieldMeta`), not the
    // excess-property check's (the source is not fresh), and not weak-type
    // detection's (`header` / `accessorKey` are in common, and both are
    // required here).
    const carriesReferenceTo: { header: string; accessorKey: string; referenceTo?: unknown } =
      { header: 'h', accessorKey: 'a', referenceTo: 'account' };
    const untombstoned: Omit<EnrichedColumn, 'referenceTo'> = carriesReferenceTo;
    expect(untombstoned.accessorKey).toBe('a');
  });
});
