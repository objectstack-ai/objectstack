/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6459 — the data-table SCHEMA SLOT ObjectGrid fills (the receiver
 * half of the seam whose producer half #6004 typed).
 *
 * ⚠️ THE DEFECT IS TYPE-LEVEL, SO A RENDERING TEST IS BLIND TO IT — same as
 * `columnEmitBoundary-6004.test.ts` next door, and for the same reason: a grid
 * renders identically with `const dataTableSchema: any`. What can fail is a
 * COMPILE, so these pins are compile-time and this file's value is that
 * `tsc -p tsconfig.test.json` reads it (verified with `--listFiles`, not
 * assumed — the package build's program excludes `__tests__`).
 *
 * The mechanism pinned here is DIFFERENT from #6004's. There, `.map()`
 * laundered freshness away and only `?: never` tombstones could refuse; here
 * both writers are literals sitting DIRECTLY in annotated positions, so
 * excess-property checking is the live instrument — PROVIDED the type has no
 * index signature. `BaseSchema`'s `[key: string]: any` (which `DataTableSchema`
 * inherited until objectui#8347) made every key a member, and a check that
 * refuses non-members has nothing to refuse when non-membership cannot exist.
 * `RemoveIndexSignature` in `ObjectGrid.tsx` is what turned the annotation from
 * inert to able-to-fail (it strips nothing since objectui#8347), and the pins
 * below hold each half of that claim separately.
 */
import { describe, it, expect } from 'vitest';
import type { DataTableSchema, TableColumn } from '@object-ui/types';
import type {
  DeclaredDataTableSchema,
  ObjectGridDataTableSchema,
  ObjectGridDataTableSchemaHolds,
} from '../ObjectGrid';

/** Compile-time truth assertion, erased at runtime — only `tsc` checks these. */
type Expect<T extends true> = T;

/** Compile-time equality, exact in both directions (not mutual assignability). */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
  ? true
  : false;

/** Membership probe, in the same shape `columnHoldsExpiry-6424.test.ts` uses. */
type Has<K extends string, T> = K extends keyof T ? true : false;

/**
 * objectui#7201 — the two states a schema-level hold can be in.
 *
 * Spelled as STRING literals so that when a verdict flips, `tsc` prints the old
 * and the new one at the failing line and each names the prose that then needs
 * re-deriving. An `Expect<false>` would only report that `false` does not
 * satisfy `true`, which points at nothing.
 */
type DeclaredUpstream =
  'DECLARED by DataTableSchema — this hold is REDUNDANT. Re-derive the census prose in ObjectGrid.tsx (the census section, and the ObjectGridDataTableSchemaHolds docblock under it) before changing anything.';
type HeldLocally =
  'UNDECLARED by DataTableSchema — this hold is LOAD-BEARING. Re-derive the census prose in ObjectGrid.tsx (the census section, and the ObjectGridDataTableSchemaHolds docblock under it) before changing anything.';

/**
 * ⚠️ Probes `DeclaredDataTableSchema`, NOT `DataTableSchema`, and that was not
 * cosmetic: `DataTableSchema` inherited `BaseSchema`'s `[key: string]: any`
 * until objectui#8347, so `string extends keyof DataTableSchema` and the
 * membership question was ALWAYS-TRUE against it — an instrument with no
 * `false` to give. The control test below pinned both halves of that, and is
 * flipped since objectui#8347 made the raw type able to answer `false` too.
 */
type HoldVerdict<K extends string> = K extends keyof DeclaredDataTableSchema
  ? DeclaredUpstream
  : HeldLocally;

/**
 * Records the measured verdict for ONE member of the holds interface.
 *
 * `K` is constrained to `keyof ObjectGridDataTableSchemaHolds`, so a member
 * renamed or removed without its verdict line following it fails to compile —
 * that, plus the completeness pin below, is what makes the gate PER HOLD rather
 * than per key somebody remembered.
 */
type PinHold<K extends keyof ObjectGridDataTableSchemaHolds, V extends HoldVerdict<K>> = V;

const columns: TableColumn[] = [{ header: 'Name', accessorKey: 'name' }];

describe('objectui#6459 — the schema slot annotation is an instrument, not a decoration', () => {
  /**
   * ⭐ THE ROOT CAUSE, as it was: a bare `DataTableSchema` annotation refused
   * NOTHING. The assignment below COMPILED — the bogus key written out longhand
   * in a FRESH literal, the strongest position excess-property checking ever
   * has, and the inherited `[key: string]: any` still admitted it. Measured on
   * the real seam before the fix was shaped (`tsc --noEmit` exit 0, zero
   * diagnostics). This docblock said that if it ever went red, `BaseSchema`
   * had changed underneath and `RemoveIndexSignature` in `ObjectGrid.tsx`
   * needed re-measuring: objectui#8347 removed the signature, the row went
   * red, and it is flipped here. The local strip is redundant from that day
   * (it strips nothing now); retiring it is left out of the removal PR.
   */
  it('a bare `DataTableSchema` annotation refuses a bogus key at a fresh literal since objectui#8347', () => {
    const blind: DataTableSchema = {
      type: 'data-table',
      columns,
      data: [],
      // @ts-expect-error — `DataTableSchema` declares no such key, and `BaseSchema` carries no index signature (objectui#8347)
      bogusKeyRefusedNowhere: 'admitted by the index signature until objectui#8347',
    };
    expect(blind.type).toBe('data-table');
  });

  /**
   * …and the index signature was exactly what separated the two types: present
   * on `DataTableSchema`, stripped from the seam type. This docblock predicted
   * that the first line would go red if `@object-ui/types` removed the signature
   * from `BaseSchema` — objectui#8347 did, and it is flipped: neither type is
   * indexed by `string` now.
   */
  it('neither `DataTableSchema` nor the seam type is indexed by `string` (objectui#8347)', () => {
    type _UpstreamHasNone = Expect<string extends keyof DataTableSchema ? false : true>;
    type _SeamHasNone = Expect<string extends keyof ObjectGridDataTableSchema ? false : true>;
    expect(true).toBe(true);
  });

  /**
   * THE SAME SHAPE, against the seam type: REFUSED. One cause only — with the
   * index signature stripped the key is a non-member, and the literal is fresh,
   * so TS2353 names it. This is the "shown able to fail" the card demanded.
   */
  it('the seam type refuses a bogus key written out in a fresh literal', () => {
    const refused: ObjectGridDataTableSchema = {
      type: 'data-table',
      columns,
      data: [],
      // @ts-expect-error objectui#6459 — undeclared key, refused once the index signature is stripped.
      bogusKeyRefusedHere: true,
    };
    expect(refused.type).toBe('data-table');
  });

  /**
   * The group-table writer is the same instrument: `buildGroupedTableSchema`
   * returns a literal contextually typed by the annotation, so a longhand key
   * is fresh there too, and the spread it carries comes from the already
   * checked `const` — every key entering the spread was refused or admitted at
   * ITS literal. Pinned in the writer's exact shape (spread + longhand keys in
   * an annotated arrow return).
   */
  it('the seam type refuses a bogus key in the grouped writer shape (spread + longhand)', () => {
    const base: ObjectGridDataTableSchema = { type: 'data-table', columns, data: [] };
    const build = (): ObjectGridDataTableSchema => ({
      ...base,
      pagination: false,
      // @ts-expect-error objectui#6459 — longhand keys stay fresh in an annotated return literal.
      bogusGroupKey: 1,
    });
    expect(build().pagination).toBe(false);
  });

  /**
   * ⭐ THE INSTRUMENT'S BOUNDARY, pinned so nobody mistakes this for
   * tombstone-grade coverage. This assignment MUST COMPILE: the value is
   * NON-FRESH (it has a declared type of its own), and assignability admits
   * extra members — that is structural typing, not a defect. A key RETIRED by
   * ruling still needs a `?: never` tombstone (see
   * `ObjectGridRetiredOptionsTombstone`); the open census cannot be
   * tombstoned, because a tombstone needs the key's name. If this ever goes
   * red, TypeScript tightened and both docblocks need re-measuring.
   */
  it('a bogus key riding a non-fresh value is admitted (assignability, the known boundary)', () => {
    const staged: { type: 'data-table'; columns: TableColumn[]; data: unknown[]; smuggled?: string } = {
      type: 'data-table',
      columns,
      data: [],
      smuggled: 'assignability admits extra members',
    };
    const slot: ObjectGridDataTableSchema = staged;
    expect(slot.type).toBe('data-table');
  });

  /**
   * The two schema-level keys that were the whole census, measured on
   * `38a123cac` by diffing the 46 flat-literal keys (+ the 8 group-literal
   * keys) against `DataTableSchema` + `BaseSchema` declared members.
   *
   * ⚠️ They are no longer HELD, and this assertion is why nobody noticed:
   * objectui#6882 (2026-08-30) DECLARED both on `DataTableSchema`, and the
   * assertion below stays green either way. It pins that the seam ACCEPTS the
   * two keys — true while they are held here, equally true once they arrive
   * through `DeclaredDataTableSchema`. An acceptance pin cannot express a hold's
   * ENTRY CONDITION, so this suite could never have gone red at the moment of
   * loss. Re-derived by objectui#7196; the diff now leaves ZERO undeclared keys,
   * and `ObjectGrid.tsx`'s `ObjectGridDataTableSchemaHolds` carries the full
   * record. The guard that WOULD have caught it is the column-level twin's:
   * `columnHoldsExpiry-6424.test.ts` asserts `TableColumn` does not declare
   * `pinned`. Filed by #7196 as a separate finding, ⛔ deliberately not a rider;
   * objectui#7201 is that finding, and the transplanted gate is DIRECTLY BELOW —
   * so the sentence above is now historical, not a live gap.
   *
   * The assertion itself keeps its value unchanged: both keys must remain
   * writable at this seam, whichever side declares them. ⚠️ It is still an
   * ACCEPTANCE pin and still green either way — the expiry gate below is a
   * SEPARATE claim, not a strengthening of this one.
   */
  it('accepts both schema-level keys — renderCellEditor and cellClassName', () => {
    const held: ObjectGridDataTableSchema = {
      type: 'data-table',
      columns,
      data: [],
      cellClassName: 'px-3 py-1',
      renderCellEditor: (ctx) => (ctx.column ? null : null),
    };
    expect(held.cellClassName).toBe('px-3 py-1');
  });

  /**
   * ⭐ objectui#7201 — THE EXPIRY GATE. The acceptance pin above cannot express
   * an ENTRY CONDITION; this can. It is the schema-level transplant of
   * `columnHoldsExpiry-6424.test.ts`, in the same package and the same idiom.
   *
   * ## Why it records a VERDICT rather than a bare "is not declared"
   *
   * The column-level twin carries BOTH polarities, because its keys are in
   * different states: `headerIcon` is pinned as DECLARED by `TableColumn` (the
   * post-expiry state, `:64` there) and `pinned` as NOT declared (still held,
   * `:138`). Both schema-level holds are in the FIRST state — objectui#6882
   * declared them on 2026-08-30 and objectui#7196 re-derived the prose — so a
   * bare "is NOT declared" would be FALSE here for both keys: a permanently red
   * suite, which is not a gate. What this file can honestly pin is each hold's
   * MEASURED verdict, in a shape that reddens when it flips EITHER way:
   *
   *   - HELD to DECLARED is the event the census was blind to (objectui#7201);
   *   - DECLARED to HELD is the event that would silently invalidate the
   *     "removing these members is inert" measurement objectui#6919 waits on —
   *     the hold would become load-bearing again with nothing going red.
   *
   * The "is NOT declared" shape the card names is present and live in this
   * suite: it is the `HeldLocally` half, exercised on control keys in the next
   * test, because there is no hold left to exercise it on.
   *
   * ⚠️ FOR objectui#6919, WHICH REMOVES THESE MEMBERS: this test is where the
   * removal reports. Deleting both members makes the pins below fail their `K`
   * constraint and takes `keyof ObjectGridDataTableSchemaHolds` to `never`; the
   * body is then replaced by a single
   * `Expect<Equal<keyof ObjectGridDataTableSchemaHolds, never>>`. That red is
   * the gate working — the hold set may not move without this file and the
   * census prose moving with it.
   */
  it('every schema-level hold carries its measured declaredness verdict', () => {
    type _RenderCellEditor = PinHold<'renderCellEditor', DeclaredUpstream>;
    type _CellClassName = PinHold<'cellClassName', DeclaredUpstream>;
    // The quantifier, made total in the other direction: a hold ADDED without a
    // verdict line above cannot slip through, because the key set is pinned too.
    type _EveryHoldPinned = Expect<
      Equal<keyof ObjectGridDataTableSchemaHolds, 'renderCellEditor' | 'cellClassName'>
    >;
    expect(true).toBe(true);
  });

  /**
   * Every verdict above is a probe answer, so the probe must be shown able to
   * give the OTHER answer in this exact shape — the discipline
   * `columnHoldsExpiry-6424.test.ts` states as "every zero here has a positive
   * control in the same query shape".
   *
   * ⚠️ All three controls are keys this change does not touch, so they are legal
   * on both sides of it: they control for the instrument, not for the diff.
   */
  it('the verdict probe returns BOTH verdicts — live controls in the same shape', () => {
    // Live, declared: a required member of the schema slot.
    type _CtrlDeclared = Expect<Equal<HoldVerdict<'columns'>, DeclaredUpstream>>;
    // Live, undeclared: a real key from the COLUMN vocabulary next door, which
    // `DataTableSchema` has never declared. This is the "is NOT declared" claim
    // the card asks for, running green on a key that genuinely is not declared.
    type _CtrlHeld = Expect<Equal<HoldVerdict<'accessorKey'>, HeldLocally>>;
    // …and a synthetic one, so the control does not itself rest on a verdict
    // somebody could change upstream.
    type _CtrlHeldSynthetic = Expect<Equal<HoldVerdict<'zzNotADataTableSchemaKeyZZ'>, HeldLocally>>;
    expect(true).toBe(true);
  });

  /**
   * ⭐ THE CONTROL ON THE CHOICE OF TYPE, which is the one place this transplant
   * is NOT literal. Read against the raw `DataTableSchema`, the membership
   * question was ALWAYS-TRUE: `BaseSchema`s `[key: string]: any` made
   * `string extends keyof DataTableSchema`, so a nonsense key was a member. A
   * gate written the obvious way — asking `DataTableSchema` whether it declares
   * the held key — would therefore have been an instrument that can only answer
   * "yes", green forever: the same failure objectui#7201 was filed about, one
   * level up. The first line pinned that blindness; the second pins that the strip
   * `ObjectGrid.tsx` already derives is what restores a usable `false`.
   *
   * The first line went red when objectui#8347 dropped `BaseSchema`'s index
   * signature, as predicted here, and is flipped: the raw probe can refuse now,
   * so both types answer alike.
   */
  it('the raw `DataTableSchema` probe can refuse since objectui#8347, as the stripped one always could', () => {
    type _RawCanRefuse = Expect<
      Has<'zzNotADataTableSchemaKeyZZ', DataTableSchema> extends false ? true : false
    >;
    type _StrippedCanRefuse = Expect<
      Has<'zzNotADataTableSchemaKeyZZ', DeclaredDataTableSchema> extends false ? true : false
    >;
    expect(true).toBe(true);
  });

  /**
   * The strip is HOMOMORPHIC — declared members survive with their exact
   * shapes: required stays required (`columns`), optional stays optional and
   * typed (`singleClickEdit`). A strip that dropped or widened members would
   * compile the seam annotation trivially and check nothing.
   */
  it('declared members survive the strip with modifiers intact', () => {
    type _ColumnsSurvive = Expect<DeclaredDataTableSchema['columns'] extends TableColumn[] ? true : false>;
    type _SingleClickTyped = Expect<
      DeclaredDataTableSchema['singleClickEdit'] extends boolean | undefined ? true : false
    >;
    // @ts-expect-error objectui#6459 — `columns` is required; the mapped type must not have made it optional.
    const missing: ObjectGridDataTableSchema = { type: 'data-table', data: [] };
    expect(missing.type).toBe('data-table');
  });
});
