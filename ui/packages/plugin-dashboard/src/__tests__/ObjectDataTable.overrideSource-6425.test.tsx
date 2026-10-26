/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The CONSUMER half of `declared = enforced` for `ObjectDataTable`'s column
 * seam (objectui#6425). `ObjectDataTable.emitBoundary-6373.test.tsx` is its
 * twin from the other end: that one asks what the producer WRITES into the
 * `TableColumn[]` slot, this one asks what it READS off the authored column.
 *
 * `enrich()` handed `buildFieldMeta` six values taken off the authored column.
 * Five — `format`, `options`, `referenceTo`, `currency`, `decimals` — are
 * declared by neither `TableColumn` nor its `TableColumnSchema` zod mirror.
 * Three arrived through `(col as any)`; the other two through
 * `NormalizedColumn`'s `[key: string]: any`, which answers `any` just as
 * loudly without the tell. `AuthoredColumnOverrides` replaces both with a
 * written hold per key plus a derived refusal band.
 *
 * ## The ruling landed — this file now pins the ruled state
 *
 * This suite began as the PREREQUISITE for the declare-or-retire ruling: the
 * runtime half measures, per key, whether an authored override reaches
 * anything at all, so the ruling could be made on evidence. The maintainer
 * ruled per key on 2026-08-27 (objectui#6425): `format` / `options` /
 * `currency` DECLARED on `TableColumn` + its zod mirror; `decimals` RETIRED
 * immediately (the authored read is gone; the key is refused — since
 * objectui#6625 by an explicit tombstone rather than by the derived band,
 * because that card retired the `FieldMeta` member the band derived it from);
 * `referenceTo` routed to objectui#6597 (⛔ not declared as spelled, and not
 * decided here — a HELD key needed a demand MEASUREMENT the per-key ruling
 * itself could not make). objectui#6597 measured no authoring story and
 * RETIRED it too, the same mechanism as `decimals`: refused by an explicit
 * tombstone since the key left `keyof FieldMeta`. The measurements below are
 * unchanged because neither ruling changed behaviour; what changed is which
 * artefact answers for each key.
 *
 * ## Every zero here is paired with a positive control
 *
 * Two of the five reach no reader. A test that renders two columns and finds
 * them equal proves that only if the SAME query shape is shown separating two
 * columns elsewhere — otherwise it is measuring a broken harness. So each
 * inert pair sits next to a live pair built the same way: `decimals` against
 * `currency`, `referenceTo` against `options`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    // The same stand-in the cells suite uses: it invokes each column's `cell`
    // closure, which is the only thing that reads the overrides under test.
    SchemaRenderer: ({ schema }: any) => {
      const cols = schema.columns || [];
      const rows = schema.data || [];
      return (
        <table>
          <tbody>
            {rows.map((row: any, i: number) => (
              <tr key={i}>
                {cols.map((c: any) => (
                  <td key={c.accessorKey} data-testid={`cell-${c.accessorKey}`}>
                    {typeof c.cell === 'function' ? c.cell(row[c.accessorKey], row) : String(row[c.accessorKey] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    useDataScope: () => undefined,
    SchemaRendererContext: actual.SchemaRendererContext,
  };
});

import { ObjectDataTable, normalizeColumns } from '../ObjectDataTable';
import type { AuthoredColumnOverrides, ObjectDataTableColumnHolds } from '../ObjectDataTable';

afterEach(() => cleanup());

/**
 * Render one table over a row whose two fields hold the SAME value, so the
 * only thing that can separate the two cells is the override under test.
 */
async function renderPair(
  fields: Record<string, any>,
  row: Record<string, any>,
  columns: any[],
): Promise<{ a: string; b: string }> {
  const dataSource = {
    find: async () => ({ data: [row] }),
    getObjectSchema: async () => ({ fields }),
  };
  render(
    <ObjectDataTable
      schema={{ type: 'object-data-table', objectName: 'probe', columns } as any}
      dataSource={dataSource}
    />,
  );
  await waitFor(() => expect(screen.getByTestId('cell-a')).toBeInTheDocument(), { timeout: 2000 });
  await waitFor(() => expect(screen.getByTestId('cell-a').textContent).not.toBe(''), { timeout: 2000 });
  return {
    a: screen.getByTestId('cell-a').textContent ?? '',
    b: screen.getByTestId('cell-b').textContent ?? '',
  };
}

/* ── the runtime half: what each held key actually reaches ────────────────── */

describe('per-key liveness of the five undeclared overrides (#6425)', () => {
  it('currency IS live — it beats the symbol inferred from `format`', async () => {
    // The positive control for the `decimals` zero below: same harness, same
    // two-columns-over-equal-values shape, and it SEPARATES them.
    const { a, b } = await renderPair(
      { a: { type: 'number' }, b: { type: 'number' } },
      { a: 150000, b: 150000 },
      [
        { header: 'Plain', accessorKey: 'a', format: '$0,0' },
        { header: 'Euro', accessorKey: 'b', format: '$0,0', currency: 'EUR' },
      ],
    );
    expect(a).toMatch(/150,000/);
    expect(b).toMatch(/150,000/);
    expect(b).not.toBe(a);
    expect(b).toContain('€');
  });

  it('decimals reaches NOTHING — the RETIRED key changes no render (ruling, 2026-08-27)', async () => {
    // Measured statically too: zero `.decimals` reads across `@object-ui/fields`,
    // `@object-ui/i18n` and `@object-ui/components`. `NumberCellRenderer` reads
    // `scale`; `PercentCellRenderer` reads `precision`; `renderFieldValue`'s
    // percent branch counts digits in the FORMAT STRING. That measurement is
    // what justified the ruling's RETIRE verdict — no user could reach the
    // key — and this same pin now proves the retire itself changed nothing:
    // an authored `decimals` renders byte-identical to its absence, before
    // the read was removed and after.
    //
    // objectui#6625 extends what this same unchanged assertion covers: the
    // `FieldMeta` MEMBER and `buildFieldMeta`'s schema-derived write are gone
    // too, so this now also measures that removing the write changed no render
    // — which is the whole behaviour claim of that card.
    const { a, b } = await renderPair(
      { a: { type: 'number' }, b: { type: 'number' } },
      { a: 3.14159, b: 3.14159 },
      [
        { header: 'Plain', accessorKey: 'a' },
        { header: 'Three places', accessorKey: 'b', decimals: 3 },
      ],
    );
    expect(a).not.toBe('');
    expect(b).toBe(a);
  });

  it('options IS live — an authored option list relabels the badge', async () => {
    // The positive control for the `referenceTo` zero below.
    const schemaOptions = [{ value: 'tech', label: 'Technology' }];
    const { a, b } = await renderPair(
      {
        a: { type: 'select', options: schemaOptions },
        b: { type: 'select', options: schemaOptions },
      },
      { a: 'tech', b: 'tech' },
      [
        { header: 'From schema', accessorKey: 'a' },
        { header: 'Overridden', accessorKey: 'b', options: [{ value: 'tech', label: 'Overridden' }] },
      ],
    );
    expect(a).toBe('Technology');
    expect(b).toBe('Overridden');
  });

  it('referenceTo reaches NOTHING on this path', async () => {
    // `LookupCellRenderer` resolves its target from `reference_to` / `reference`
    // — never `referenceTo` — and `computeLookupExpand` builds `$expand` from
    // the OBJECT SCHEMA's field types, so authoring it on a column does not add
    // the field to the expand whitelist either. Values arrive already expanded.
    //
    // This measurement is what objectui#6597 acted on: `AuthoredColumnOverrides`
    // no longer even reads `referenceTo` off the authored column (`enrich()`'s
    // `overrides:` object omits it), so the assertion below is now pinning "the
    // withdraw verdict changed nothing" the same way the `decimals` test above
    // pins its own retirement. The literal below still types as `any[]` at the
    // `renderPair` call boundary, so authoring the retired spelling on a column
    // is silently ignored at run time — exactly as before the retirement.
    const expanded = { id: 'acc-1', name: 'Acme' };
    const { a, b } = await renderPair(
      { a: { type: 'lookup' }, b: { type: 'lookup' } },
      { a: expanded, b: { ...expanded } },
      [
        { header: 'Plain', accessorKey: 'a' },
        { header: 'With referenceTo', accessorKey: 'b', referenceTo: 'account' },
      ],
    );
    expect(a).toContain('Acme');
    expect(b).toBe(a);
  });
});

/* ── the type-level half ─────────────────────────────────────────────────── */

/** True only when `T` is `any` — the one type `0 extends (1 & T)` admits. */
type IsAny<T> = 0 extends (1 & T) ? true : false;

/** What `enrich` receives: the authored bag `normalizeColumns` produces. */
type AuthoredBag = ReturnType<typeof normalizeColumns>[number];

describe('the override reads are typed, and the band can FAIL (#6425)', () => {
  it('turns the `any` reads into declared ones', () => {
    // ⭐ The before/after pair, in one file and one query shape. The bag is the
    // pre-fix read: `(col as any).currency` and `col.decimals` both answered
    // `any`, the first loudly and the second through the index signature. The
    // keyhole answers the declared type. `IsAny` returning `true` for the bag
    // is the positive control that makes the two `false`s a measurement rather
    // than a query that never fires.
    const bagCurrencyIsAny: IsAny<AuthoredBag['currency']> = true;
    const bagDecimalsIsAny: IsAny<AuthoredBag['decimals']> = true;
    const heldCurrencyIsAny: IsAny<AuthoredColumnOverrides['currency']> = false;
    // Still INDEXABLE after objectui#6625 retired the `FieldMeta` member: the
    // key is carried by the explicit tombstone now, so this stays a real
    // measurement instead of becoming TS2339 on a key that stopped existing.
    const heldDecimalsIsAny: IsAny<AuthoredColumnOverrides['decimals']> = false;
    // Same shape, objectui#6597: `referenceTo` moved from HELD (`unknown`, via
    // `ObjectDataTableColumnHolds`) to RETIRED (`never`, via the explicit
    // tombstone) without ever becoming unindexable — both answers are `false`
    // here, so this line alone cannot tell HELD from RETIRED. The literal test
    // below is what tells them apart.
    const heldReferenceToIsAny: IsAny<AuthoredColumnOverrides['referenceTo']> = false;

    expect([bagCurrencyIsAny, bagDecimalsIsAny]).toEqual([true, true]);
    expect([heldCurrencyIsAny, heldDecimalsIsAny, heldReferenceToIsAny]).toEqual([false, false, false]);
  });

  it('accepts exactly the adjudicated set', () => {
    // The positive control. Without it the refusals below could be satisfied by
    // a type that refuses everything, which would pin nothing. `decimals` and
    // `referenceTo` are deliberately NOT here any more: both rulings retired
    // them, and their refusals are pinned with the band below.
    const accepted: AuthoredColumnOverrides = {
      accessorKey: 'amount',
      type: 'currency',
      format: '$0,0',
      options: [{ value: 'tech', label: 'Technology' }],
      currency: 'EUR',
    };
    expect(accepted.currency).toBe('EUR');
  });

  it('refuses an unheld FieldMeta member — and the BAND is what refuses it', () => {
    // Checked by `tsc -p tsconfig.test.json`, which this package's `type-check`
    // script chains and CI's Type Check job runs. A directive whose error stops
    // happening is reported UNUSED (TS2578), so this cannot decay into
    // decoration.
    //
    // ⚠️ The source is a VARIABLE, not a fresh object literal, on purpose. A
    // literal is refused by the excess-property check whether or not the band
    // exists, so it would pin "something refused this" without pinning what —
    // exactly the decay the emit-side twin documents. Assigning a non-fresh
    // source reaches the band and nothing else: measured by removing the band
    // and watching this directive, and only this one, turn TS2578.
    const carriesLabel: { accessorKey: string; label?: string } = { accessorKey: 'amount' };
    // @ts-expect-error objectui#6425 — `label` is in the derived refusal band.
    const labelRefused: AuthoredColumnOverrides = carriesLabel;
    expect(labelRefused.accessorKey).toBe('amount');

    const carriesName: { accessorKey: string; name?: string } = { accessorKey: 'amount' };
    // @ts-expect-error objectui#6425 — `name` is in the derived refusal band.
    const nameRefused: AuthoredColumnOverrides = carriesName;
    expect(nameRefused.accessorKey).toBe('amount');

    // `decimals` used to be HELD here; the ruling (2026-08-27) RETIRED it into
    // the derived band. objectui#6625 then retired the `FieldMeta` MEMBER the
    // band derived it from, so the key left the band's POOL — and the refusal
    // is carried by `ObjectDataTableRetiredDecimalsTombstone` instead. ⚠️ The
    // verdict and this directive are BOTH unchanged; only the artefact that
    // enforces them moved. Without that tombstone this directive would have
    // turned TS2578-unused — the pin going green because its subject stopped
    // existing. The test below is the control that proves it did not.
    const carriesDecimals: { accessorKey: string; decimals?: number } = { accessorKey: 'amount' };
    // @ts-expect-error objectui#6425/#6625 — `decimals` refused by the explicit retired-key tombstone.
    const decimalsRefused: AuthoredColumnOverrides = carriesDecimals;
    expect(decimalsRefused.accessorKey).toBe('amount');

    // `referenceTo` used to be HELD here (`ObjectDataTableColumnHolds`); the
    // ruling this file is named for routed the DEMAND question to objectui#6597
    // rather than deciding it. That card measured no authoring story and
    // RETIRED the `FieldMeta` member itself, so — same mechanism as `decimals`
    // above — the key left the band's POOL and its refusal is carried by
    // `ObjectDataTableRetiredReferenceToTombstone` instead. Without that
    // tombstone this directive would have turned TS2578-unused (or, before the
    // ruling, would not have been an error at all — the key was HELD as
    // `unknown`). The counter-control test below proves the tombstone, not the
    // former hold, is what refuses it now.
    const carriesReferenceTo: { accessorKey: string; referenceTo?: unknown } = { accessorKey: 'amount' };
    // @ts-expect-error objectui#6425/#6597 — `referenceTo` refused by the explicit retired-key tombstone.
    const referenceToRefused: AuthoredColumnOverrides = carriesReferenceTo;
    expect(referenceToRefused.accessorKey).toBe('amount');

    // `reference_to` was a `FieldMeta` member from objectui#6694, so the
    // DERIVED band refused it by membership. objectui#11070 round 4 retired the
    // member (the cell reads `reference` alone), so — the same mechanism again
    // — the key left the band's POOL and
    // `ObjectDataTableRetiredReferenceToSnakeTombstone` carries its refusal.
    const carriesReferenceToSnake: { accessorKey: string; reference_to?: unknown } = { accessorKey: 'amount' };
    // @ts-expect-error objectui#6694/#11070 — `reference_to` refused by the explicit retired-key tombstone.
    const referenceToSnakeRefused: AuthoredColumnOverrides = carriesReferenceToSnake;
    expect(referenceToSnakeRefused.accessorKey).toBe('amount');

    // `display_field` was a `FieldMeta` member from objectui#6694 as well, so
    // the DERIVED band refused it by membership. objectui#11070's text-family
    // round retired the member (the cell reads `displayField`), so the key
    // left the band's POOL and `ObjectDataTableRetiredDisplayFieldSnakeTombstone`
    // carries its refusal.
    const carriesDisplayFieldSnake: { accessorKey: string; display_field?: unknown } = { accessorKey: 'amount' };
    // @ts-expect-error objectui#6694/#11070 — `display_field` refused by the explicit retired-key tombstone.
    const displayFieldSnakeRefused: AuthoredColumnOverrides = carriesDisplayFieldSnake;
    expect(displayFieldSnakeRefused.accessorKey).toBe('amount');
  });

  it('the TOMBSTONE is what refuses `display_field` — not the band (objectui#11070 text-family round)', () => {
    // The counter-control, built like the one above: `Omit<…, 'display_field'>`
    // is `AuthoredColumnOverrides` minus that tombstone and nothing else, and
    // it ACCEPTS the source the directive refuses.
    const carriesDisplayFieldSnake: { accessorKey: string; display_field?: unknown } = { accessorKey: 'amount' };
    const untombstoned: Omit<AuthoredColumnOverrides, 'display_field'> = carriesDisplayFieldSnake;
    expect(untombstoned.accessorKey).toBe('amount');
  });

  it('the TOMBSTONE is what refuses `reference_to` — not the band (objectui#11070 round 4)', () => {
    // The counter-control, built like the two below it: `Omit<…, 'reference_to'>`
    // is `AuthoredColumnOverrides` minus that tombstone and nothing else, and it
    // ACCEPTS the source the directive above refuses — so the refusal is the
    // tombstone's, not the derived band's (which no longer reaches the key),
    // not the excess-property check's (the source is a variable) and not
    // weak-type detection's (`accessorKey` is in common).
    const carriesReferenceToSnake: { accessorKey: string; reference_to?: unknown } = { accessorKey: 'amount' };
    const untombstoned: Omit<AuthoredColumnOverrides, 'reference_to'> = carriesReferenceToSnake;
    expect(untombstoned.accessorKey).toBe('amount');
  });

  it('the TOMBSTONE is what refuses `decimals` — not the band, not freshness', () => {
    // ⭐ objectui#6625's counter-control, built the same way as the band's
    // control below. `Omit<…, 'decimals'>` is `AuthoredColumnOverrides` minus
    // the retired-key tombstone and nothing else, and it ACCEPTS the very
    // source the directive above refuses. So the refusal comes from the
    // tombstone:
    //  - not from the DERIVED band, which cannot reach `decimals` any more —
    //    the key is no longer a `FieldMeta` member, so it is out of the pool
    //    `UnheldFieldMetaOverrideKey` excludes from;
    //  - not from the excess-property check, because the source is a VARIABLE,
    //    not a fresh literal;
    //  - not from weak-type detection, because `accessorKey` is in common.
    // Delete the tombstone and this assignment still compiles while the
    // directive above turns TS2578 — which is exactly the blindness this card
    // existed to prevent, made observable in one file.
    const carriesDecimals: { accessorKey: string; decimals?: number } = { accessorKey: 'amount' };
    const untombstoned: Omit<AuthoredColumnOverrides, 'decimals'> = carriesDecimals;
    expect(untombstoned.accessorKey).toBe('amount');
  });

  it('the TOMBSTONE is what refuses `referenceTo` — not the band, not a lingering hold', () => {
    // ⭐ objectui#6597's counter-control, built the same way as `decimals`'s
    // above. `Omit<…, 'referenceTo'>` is `AuthoredColumnOverrides` minus the
    // retired-key tombstone and nothing else, and it ACCEPTS the very source
    // the directive above refuses. So the refusal comes from the tombstone:
    //  - not from `ObjectDataTableColumnHolds`, which is empty now — there is
    //    no lingering `referenceTo?: unknown` member for this source to match;
    //  - not from the DERIVED band, which cannot reach `referenceTo` any more —
    //    the key is no longer a `FieldMeta` member, so it is out of the pool
    //    `UnheldFieldMetaOverrideKey` excludes from;
    //  - not from the excess-property check, because the source is a VARIABLE,
    //    not a fresh literal;
    //  - not from weak-type detection, because `accessorKey` is in common.
    // Delete the tombstone and this assignment still compiles while the
    // directive above turns TS2578 — exactly the blindness objectui#6373's
    // sibling tombstone was built to prevent, made observable here for the
    // key this card retired.
    const carriesReferenceTo: { accessorKey: string; referenceTo?: unknown } = { accessorKey: 'amount' };
    const untombstoned: Omit<AuthoredColumnOverrides, 'referenceTo'> = carriesReferenceTo;
    expect(untombstoned.accessorKey).toBe('amount');
  });

  it('the same source is ACCEPTED by the holds without the band', () => {
    // The band's counter-control: this is `AuthoredColumnOverrides` minus the
    // `?: never` members, and it takes the very source the directives above
    // refuse. So the refusal comes from the band, not from the holds, not from
    // the required `accessorKey`, and not from weak-type detection.
    const carriesLabel: { accessorKey: string; label?: string } = { accessorKey: 'amount' };
    const unbanded: { accessorKey: string; type?: string } & ObjectDataTableColumnHolds = carriesLabel;
    expect(unbanded.accessorKey).toBe('amount');
  });

  it('refuses a key outside the override vocabulary written by hand', () => {
    // Needs no band: a hand-written property is subject to the excess-property
    // check. Kept because it is the OTHER way a tolerance gets added back, and
    // separated from the band pins because the two are different machinery.
    // @ts-expect-error objectui#6425 — `scale` is not an adjudicated override key.
    const written: AuthoredColumnOverrides = { accessorKey: 'amount', scale: 2 };
    expect(written.accessorKey).toBe('amount');
  });

  it('refuses a READ of an unadjudicated key — the mechanism `enrich` runs on', () => {
    // ⭐ The two pins above act on ASSIGNMENT INTO the keyhole. This one acts on
    // the read OUT of it, which is what `enrich` actually does: it never
    // assigns a banded source, it reads `authored.currency` and friends. The
    // keyhole carries no index signature, so a key nobody adjudicated is
    // TS2339 AT THE READ — where the pre-fix code answered `any` twice over,
    // through `(col as any)` and through `NormalizedColumn`'s `[key: string]:
    // any`. This is the enforcement a future maintainer meets first.
    const authored = {} as AuthoredColumnOverrides;
    // The positive control, same query shape: an adjudicated key reads clean.
    expect(authored.currency).toBeUndefined();
    // @ts-expect-error objectui#6425 — unadjudicated key; the read itself is refused.
    const unadjudicated = authored.scale;
    expect(unadjudicated).toBeUndefined();
  });
});
