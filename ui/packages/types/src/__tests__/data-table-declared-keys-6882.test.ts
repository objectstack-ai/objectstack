/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6882 — `DataTableSchema` DECLARES the two schema-level keys
 * `data-table.tsx` has always read: `renderCellEditor` and `cellClassName`
 * (maintainer ruling 2026-08-30, option A).
 *
 * ## Why this pin is compile-time, and why a runtime pin would measure nothing
 *
 * The enforcement being added is a TYPE declaration. `data-table` behaves
 * IDENTICALLY before and after it: both keys were already read on the
 * production path — `renderCellEditor` through an `(schema as any)` cast,
 * `cellClassName` by destructuring into the class of the three UTILITY body
 * cells (selection, row-number, row-actions; a data cell folds the per-column
 * `TableColumn.cellClassName` instead, never this key — measured in the DOM by
 * `components/src/renderers/complex/__tests__/data-table-cellClassName-population-6921.test.tsx`,
 * objectui#6921) — so no render changes, no runtime value changes, and a
 * rendering test is blind to the whole change. What can fail is a COMPILE.
 * Same reading as `plugin-grid/src/__tests__/dataTableSchemaSlot-6459.test.ts`
 * next door.
 *
 * ## ⚠️ The index signature is what made the naive pin vacuous
 *
 * `DataTableSchema extends BaseSchema`, and `BaseSchema` carried
 * `[key: string]: any` until objectui#8347. So `DataTableSchema['renderCellEditor']`
 * resolved to `any` whether or not the key was declared, and every "is this key
 * there?" spelling written over the raw type answered `true` for EVERY string —
 * including `bogusKeyNobodyDeclared`. A pin written that way was green before
 * the fix, green after it, and measured nothing.
 *
 * `Declared<>` below strips the signature so NON-MEMBERSHIP can exist, which is
 * the only state in which a membership question has an answer (since
 * objectui#8347 the strip is the identity on `DataTableSchema`).
 *
 * ## ⚠️ …and `extends` alone is vacuous a second way
 *
 * `Expect<X extends true ? true : false>` is satisfied by `never` (assignable
 * to everything) and by `any`. `Equal<>` below is the invariant
 * (function-parameter-identity) comparison instead, so neither passes.
 *
 * ## How the DIRECTION is proved, rather than asserted
 *
 * Four `@ts-expect-error` directives below are the load-bearing half. TypeScript
 * reports an UNUSED `@ts-expect-error` as an error (TS2578), so each of them is
 * a claim that the instrument REFUSES something:
 *
 *   - `Expect<false>` must be refused → the assertion helper has teeth;
 *   - `Equal<never, true>` and `Equal<any, true>` must resolve `false` → the
 *     comparison is invariant, not `extends`-shaped;
 *   - `IsDeclaredOn<'…probe…'>` must resolve `false` → the strip really removed
 *     the index signature, so a non-member is answerable.
 *
 * Break any part of the instrument — make `Expect` accept anything, make
 * `Equal` bivariant, make `Declared` a no-op — and this file goes RED on the
 * now-unused directive rather than quietly passing. That is the property the
 * positive assertions borrow their meaning from.
 */
import { describe, it, expect } from 'vitest';
import type { DataTableSchema } from '../data-display.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataTableSchema as DataTableMirror } from '../zod/data-display.zod.js';
import { ObjectGridSchema as ObjectGridMirror } from '../zod/objectql.zod.js';
import { safeValidateSchema } from '../zod/index.zod.js';

/**
 * `T` with its string/number index signatures removed — the same shape
 * `plugin-grid`'s `RemoveIndexSignature` uses at the seam, restated here so
 * this package's pin does not depend on a downstream package.
 */
type Declared<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/** Is `K` a DECLARED member of `DataTableSchema` (index signature stripped)? */
type IsDeclaredOn<K extends PropertyKey> = K extends keyof Declared<DataTableSchema> ? true : false;

/* ── Direction proofs: a broken instrument makes THIS file red ─────────────── */

// @ts-expect-error objectui#6882 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#6882 — `never` must NOT read as equal to `true`. An `extends`-shaped comparison would let it through.
type _EqualRefusesNever = Expect<Equal<never, true>>;

// @ts-expect-error objectui#6882 — `any` must NOT read as equal to `true`, for the same reason.
type _EqualRefusesAny = Expect<Equal<any, true>>;

// @ts-expect-error objectui#6882 — a key nothing declares must answer `false`. If `Declared<>` stopped stripping `[key: string]: any`, this would answer `true` and the directive would go unused.
type _UndeclaredKeyIsRefused = Expect<IsDeclaredOn<'bogusKeyNobodyDeclares6882'>>;

/* ── The assertions the card is about ─────────────────────────────────────── */

/** RED before objectui#6882's declaration, green after. */
type _RenderCellEditorIsDeclared = Expect<IsDeclaredOn<'renderCellEditor'>>;
/** RED before objectui#6882's declaration, green after. */
type _CellClassNameIsDeclared = Expect<IsDeclaredOn<'cellClassName'>>;

/**
 * The context object `data-table.tsx` actually passes to the injected editor,
 * transcribed from its call site. Declaring the key with any other shape is a
 * different (and false) statement about the renderer, so the shape is pinned,
 * not just the membership.
 *
 * objectui#7188 added a SEVENTH member, `pendingRow` — the persisted `row`
 * shallow-merged with the row's staged, unsaved edits — so a `dependsOn`
 * widget can scope itself by a parent edited in the same row before it is
 * saved. `row` keeps meaning the persisted record. This pin went red on that
 * change by design (it is an `Equal`, not an `extends`) and was EXTENDED in the
 * same change, not weakened; `_SixMemberShapeIsRefused` below is the proof that
 * the instrument can tell the seventh member's presence from its absence.
 */
type CellEditorContext = {
  column: any;
  row: any;
  pendingRow: any;
  value: any;
  stage: (v: any) => void;
  commit: (v?: any) => void;
  cancel: () => void;
};

type _RenderCellEditorShape = Expect<
  Equal<
    Declared<DataTableSchema>['renderCellEditor'],
    ((ctx: CellEditorContext) => React.ReactNode) | undefined
  >
>;

/** The six-member context objectui#6882 pinned — a CONTROL now, not the shape. */
type CellEditorContextBefore7188 = {
  column: any;
  row: any;
  value: any;
  stage: (v: any) => void;
  commit: (v?: any) => void;
  cancel: () => void;
};

// @ts-expect-error objectui#7188 — the pre-#7188 six-member context must NOT read as equal to the declared shape. If it did, `Equal` could not see the seventh member and the pin above would be vacuous for exactly the change it was extended for. (One line: the directive covers only the next line, and `tsc` reports the constraint failure on the `Expect<…>` argument.)
type _SixMemberShapeIsRefused = Expect<Equal<Declared<DataTableSchema>['renderCellEditor'], ((ctx: CellEditorContextBefore7188) => React.ReactNode) | undefined>>;

/** Matches `TableColumn.cellClassName` and `BaseSchema.className` — both `string`. */
type _CellClassNameShape = Expect<Equal<Declared<DataTableSchema>['cellClassName'], string | undefined>>;

/**
 * objectui#12620 — the third schema-level runtime slot, `rowGroups`: the group
 * bands `ObjectGrid` hands a grouped table. Pinned as an exact shape, like
 * `renderCellEditor`: the members are what `data-table.tsx` reads off each
 * entry, and a member added or dropped there is a different statement.
 */
type RowGroupShape = {
  key: string;
  band: React.ReactNode;
  rows: any[];
  footer?: React.ReactNode;
  depth?: number;
};
type _RowGroupsIsDeclared = Expect<IsDeclaredOn<'rowGroups'>>;
type _RowGroupsShape = Expect<Equal<Declared<DataTableSchema>['rowGroups'], RowGroupShape[] | undefined>>;
/** The same shape without `footer` — a CONTROL: it must not read as equal. */
type RowGroupShapeWithoutFooter = Omit<RowGroupShape, 'footer'>;
// @ts-expect-error objectui#12620 — the shape without `footer` must NOT read as equal to the declared one; if it did, the pin above could not see a member go.
type _RowGroupsShapeWithoutFooterIsRefused = Expect<Equal<Declared<DataTableSchema>['rowGroups'], RowGroupShapeWithoutFooter[] | undefined>>;

describe('objectui#6882 — DataTableSchema declares the two keys data-table reads', () => {
  /**
   * The runtime half exists only so the compile-time pins above have a file
   * vitest also runs; the assertions that matter are erased before this runs.
   * It does carry one honest statement: an author writing both keys produces an
   * ordinary `DataTableSchema` value, no cast anywhere.
   */
  it('an author can write both keys on a plain DataTableSchema value', () => {
    const authored: DataTableSchema = {
      type: 'data-table',
      columns: [{ header: 'Name', accessorKey: 'name' }],
      data: [],
      cellClassName: 'px-3 py-1',
      // `pendingRow` is addressable next to `row` (objectui#7188) — destructured
      // here so an author reaching for it compiles against the declaration.
      renderCellEditor: ({ value, row, pendingRow }) => (value == null && row === pendingRow ? null : null),
    };

    expect(authored.cellClassName).toBe('px-3 py-1');
    expect(typeof authored.renderCellEditor).toBe('function');
  });

  it('the zod mirror refuses an authored `rowGroups` by name: it is a runtime slot (objectui#12620)', () => {
    const result = DataTableMirror.safeParse({
      type: 'data-table',
      columns: [{ header: 'Name', accessorKey: 'name' }],
      data: [],
      rowGroups: [{ key: 'a', band: 'A', rows: [] }],
    });
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(['rowGroups']);
    // Control: the same node without the slot parses.
    expect(DataTableMirror.safeParse({
      type: 'data-table',
      columns: [{ header: 'Name', accessorKey: 'name' }],
      data: [],
    }).success).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * objectui#6940 — `DataTableSchema.rowActions` is a BOOLEAN on the mirror too
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Maintainer ruling 2026-09-02 (director seat, summon #8, verbatim
 * 「7189 A  其他同意」), option A: the zod mirror in `../zod/data-display.zod.ts`
 * becomes `z.boolean().optional()`, aligned with the TS declaration
 * (`rowActions?: boolean`), the renderer's destructuring default
 * (`rowActions = false`), the registered input (`type: 'boolean'`),
 * `defaultProps` and the docblock example. Option B (a `boolean | array` union)
 * was NOT taken: it would permanently accept a shape the renderer only
 * truthiness-tests.
 *
 * ## Why the REFUSAL is the load-bearing half
 *
 * This is a NARROWING. A mirror that accepted both `true` and `[]` would
 * satisfy a "`true` validates" assertion on its own — that assertion was green
 * BEFORE this change for the array spelling and would stay green after a
 * union. So the pin that carries the ruling's meaning is
 * `_rowActionsArrayIsRefused` below, and it asserts not merely that the parse
 * fails but that EVERY issue it raises is ON `rowActions` — a document refused
 * for some unrelated reason would otherwise read as a passing narrowing pin.
 *
 * ## ⚠️ Two different keys are named `rowActions`
 *
 * `ObjectGridSchema.rowActions` (`../zod/objectql.zod.ts`, TS twin
 * `../objectql.ts` `interface ObjectGridSchema`) is `z.array(z.string())` — the
 * legacy bare-NAME action list, a genuinely different key that is correct as it
 * stands and is NOT touched by this ruling. The last test below pins that
 * separation, so a later sweep that "harmonises the two `rowActions`" turns red
 * here instead of silently retyping a key no ruling covers.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The two entries the ruling names — they must validate UNCHANGED. */
const CATALOG_FIXTURES = [
  'examples/schema-catalog/src/schemas/components-complex-data-table/user-table.json',
  'examples/schema-catalog/src/schemas/components-complex-data-table/full-featured-table.json',
].map((rel) => ({ rel, abs: path.join(REPO_ROOT, rel) }));

/** A minimal document that is valid except for whatever `rowActions` is set to. */
const baseDoc = {
  type: 'data-table',
  columns: [{ header: 'Name', accessorKey: 'name' }],
  data: [] as unknown[],
};

describe('objectui#6940 — the `rowActions` mirror is the declared boolean', () => {
  it('`rowActions: true` validates — the spelling the renderer, inputs and docs all teach', () => {
    const parsed = DataTableMirror.safeParse({ ...baseDoc, rowActions: true });
    expect(parsed.success ? null : parsed.error.issues).toBe(null);
  });

  it('`rowActions: false` validates too — the key is a boolean, not a truthy-only flag', () => {
    const parsed = DataTableMirror.safeParse({ ...baseDoc, rowActions: false });
    expect(parsed.success ? null : parsed.error.issues).toBe(null);
  });

  it('⭐ `rowActions: []` is REFUSED, and refused ON `rowActions`', () => {
    // `[]` was the SMALLEST value the pre-#6940 mirror accepted, and #6318
    // measured that it renders the actions column identically to `true`
    // (because `[]` is truthy) — so it made documents say something the
    // renderer cannot act on. Narrowing is the whole point of the ruling;
    // this is where that is proved.
    const parsed = DataTableMirror.safeParse({ ...baseDoc, rowActions: [] });
    expect(parsed.success, '`rowActions: []` still validates — the mirror did not narrow').toBe(false);

    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
      // Every issue must be about `rowActions`. Without this, a document
      // rejected for an unrelated reason would satisfy the assertion above.
      expect(paths, `refused, but not on rowActions: ${JSON.stringify(paths)}`).toEqual(['rowActions']);
    }
  });

  it('the published `safeValidateSchema` surface moves with it, in both directions', () => {
    // The ruling is stated about THIS entry point ("changes what
    // `safeValidateSchema` accepts on a published package"), and it is a
    // `z.union` — so the refusal has to be measured here too rather than
    // inferred from the member mirror: a sibling union member accepting the
    // document would leave the published surface unchanged.
    expect(safeValidateSchema({ ...baseDoc, rowActions: true }).success).toBe(true);
    expect(safeValidateSchema({ ...baseDoc, rowActions: [] }).success).toBe(false);
  });

  it('the two schema-catalog entries this card was filed over are on disk', () => {
    // Asserted before anything reads them: a path that silently resolved to
    // nothing would make the next test a vacuous pass.
    for (const { rel, abs } of CATALOG_FIXTURES) {
      expect(fs.existsSync(abs), `fixture not found at ${rel}`).toBe(true);
    }
  });

  it('…and both validate UNCHANGED — they author `rowActions: true` and always did', () => {
    for (const { rel, abs } of CATALOG_FIXTURES) {
      const doc = JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>;
      expect(doc.rowActions, `${rel} no longer authors the boolean this pin was written for`).toBe(true);

      const parsed = safeValidateSchema(doc);
      expect(parsed.success ? null : parsed.error.issues, `${rel} does not validate`).toBe(null);
    }
  });

  it('the list view’s same-named `rowActions` is a DIFFERENT key and still takes `string[]`', () => {
    // `ObjectGridSchema.rowActions` is the legacy bare-NAME action list. The
    // ruling leaves it alone, and the mirror-parity ratchet agrees it is in
    // parity with its TS twin (`rowActions?: string[]`) — it appears in
    // NEITHER of that file's drift ledgers. Pinned here so the two keys are not
    // later "harmonised" on the strength of sharing a name.
    const grid = { type: 'object-grid', objectName: 'accounts', rowActions: ['edit', 'delete'] };
    expect(ObjectGridMirror.safeParse(grid).success).toBe(true);

    // …and the boolean this card installs on the OTHER key is not valid here.
    expect(ObjectGridMirror.safeParse({ ...grid, rowActions: true }).success).toBe(false);
  });
});
