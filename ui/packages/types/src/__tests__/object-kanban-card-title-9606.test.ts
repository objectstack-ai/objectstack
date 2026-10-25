/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9606 — `ObjectKanbanSchema` declares `cardTitle`, the CANONICAL
 * card-title spelling, on both published faces. The legacy alias `titleField`
 * beside it stays declared and is NOT retired here.
 *
 * ## What was measurably wrong
 *
 * `@objectstack/spec` declares BOTH keys on `ObjectKanbanPropsSchema` —
 * `cardTitle` ("Field rendered as each card title") and `titleField` ("Legacy
 * fallback for `cardTitle` … Prefer `cardTitle`"). `plugin-kanban`'s
 * registration `inputs` declare both the same way, `resolveKanbanTitleField`
 * reads `cardTitle` FIRST, and this repository's root README teaches
 * `cardTitle`. This mirror declared the ALIAS ONLY: `cardTitle` read zero times
 * in `../zod/objectql.zod.ts` against a lit control of 262 `key: z.…`
 * declarations in that same file.
 *
 * ⇒ the canonical key rode `BaseSchema`'s `.passthrough()` unjudged. Measured
 * on `origin/main` `2923cea165`, and again after the declaration, with the same
 * probe — the opposite-answer pair this file freezes:
 *
 * | `safeValidateSchema({ type: 'object-kanban', objectName: 'tasks', groupBy: 'status', cardTitle: 42 })` | reading |
 * |---|---|
 * | before | `success = true`, and the parsed document KEEPS `cardTitle: 42` |
 * | after  | `success = false`, `cardTitle: Invalid input: expected string, received number` |
 *
 * A non-string reached `resolveKanbanTitleField`, which returns it as a record
 * FIELD NAME (`if (schema?.cardTitle) return schema.cardTitle;`), so the value
 * did not stop at the validator. The protocol refused that same document all
 * along; this face did not.
 *
 * ## ⛔ Why `titleField` is still here
 *
 * Director seat, batch #150 item 3, letter 1 (maintainer 「同意」): a mirror
 * cannot be narrower than the spec it mirrors, and `@objectstack/spec` still
 * declares the alias. Retiring it is an `@objectstack/spec` card (an ADR-0087
 * conversion), not a local edit. The third pin below is therefore a CONTROL as
 * much as a pin: a change that reddens it has retired something this ruling
 * forbids retiring.
 *
 * ## The firing control, and why it is this one
 *
 * Every refusal below is paired with the SAME value written under a key NOTHING
 * declares. That document is ACCEPTED, because `BaseSchema` is `.passthrough()`
 * — which is exactly the state `cardTitle` itself was in before this card. So
 * the control is not a re-implementation of the old face; it IS the old face's
 * mechanism, reached through a key nothing declares. Delete the `cardTitle`
 * declaration and every refusal here goes green while the control stays green:
 * the instrument reports its own removal.
 *
 * ## Direction
 *
 * Declaring a key on a face that already carries `.passthrough()` can only
 * NARROW what that face accepts (the TS face carried `[key: string]: any` too
 * when this was written; objectui#8347 removed it), and it narrows
 * to the SPEC's own accepted set rather than below it — `Clause-②`. The
 * direction check is asserted in the first block below rather than argued in
 * prose.
 */

import { describe, it, expect } from 'vitest';

import { ObjectKanbanSchema } from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { ObjectKanbanSchema as TsObjectKanbanSchema } from '../objectql';

/** The board every document below is a variation of — the card's own subject. */
const BOARD = { type: 'object-kanban', objectName: 'tasks', groupBy: 'status' } as const;

const board = (patch: Record<string, unknown>): Record<string, unknown> => ({ ...BOARD, ...patch });

/** Report the issues rather than `false`, so a red run says what broke. */
const reasons = (doc: unknown): string[] => {
  const r = ObjectKanbanSchema.safeParse(doc);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('the declaration narrows and cannot widen (objectui#9606)', () => {
  it('the face it sits on is passthrough, so an undeclared key was already accepted', () => {
    // If this ever fails, `cardTitle` was not riding an index signature before
    // this card and the whole "narrow only" reasoning has to be re-derived.
    const r = ObjectKanbanSchema.safeParse(board({ cardTitleUndeclared: 42 }));
    expect(r.success).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).cardTitleUndeclared).toBe(42);
  });

  it('a board that authored neither spelling is untouched', () => {
    expect(reasons({ ...BOARD })).toEqual([]);
  });
});

/* ── The three pins the ruling names ──────────────────────────────────────── */

describe('the ruling\'s pins (objectui#9606)', () => {
  it('REFUSES `cardTitle: 42` — the defect this card was filed for', () => {
    expect(reasons(board({ cardTitle: 42 }))).toEqual(['cardTitle: Invalid input: expected string, received number']);
  });

  it('CONTROL — the same 42 under an undeclared key is ACCEPTED and KEPT', () => {
    // The only difference between this document and the one above is the key
    // name, so the refusal comes from THIS declaration and from nothing else on
    // the face.
    expect(reasons(board({ cardTitleUndeclared: 42 }))).toEqual([]);
  });

  it('ACCEPTS `cardTitle: "name"` — the canonical spelling the README teaches', () => {
    expect(reasons(board({ cardTitle: 'name' }))).toEqual([]);
  });

  it('⛔ STILL ACCEPTS `titleField: "name"` — the legacy alias is NOT retired here', () => {
    // Reddening this row means the alias was retired. The ruling forbids that:
    // the spec still declares it, and a mirror may not be narrower than the
    // spec it mirrors.
    expect(reasons(board({ titleField: 'name' }))).toEqual([]);
  });

  it('accepts BOTH spellings on one board — the pair the renderer reads as `cardTitle || titleField`', () => {
    expect(reasons(board({ cardTitle: 'name', titleField: 'subject' }))).toEqual([]);
  });
});

/* ── The same readings through the PUBLISHED entry point the card measured ── */

describe('through `safeValidateSchema`, the face the card probed (objectui#9606)', () => {
  it('`cardTitle: 42` no longer succeeds, and no document carries the 42 onward', () => {
    const r = safeValidateSchema(board({ cardTitle: 42 }));
    expect(r.success).toBe(false);
  });

  it('`cardTitle: "name"` succeeds and the value survives the parse', () => {
    const r = safeValidateSchema(board({ cardTitle: 'name' }));
    expect(r.success).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).cardTitle).toBe('name');
  });

  it('`titleField: "name"` still succeeds — the control, one level up', () => {
    const r = safeValidateSchema(board({ titleField: 'name' }));
    expect(r.success).toBe(true);
    expect(r.success && (r.data as Record<string, unknown>).titleField).toBe('name');
  });
});

/* ── Type-level: the TS twin mirrors the zod face at the same requiredness ── */

/** The canonical spelling annotates — it is a declared member now, not an index-signature ride. */
export const CANONICAL_BOARD: TsObjectKanbanSchema = {
  type: 'object-kanban',
  objectName: 'tasks',
  groupBy: 'status',
  cardTitle: 'name',
};

/** The legacy alias still annotates — the type-level half of the third pin. */
export const LEGACY_BOARD: TsObjectKanbanSchema = {
  type: 'object-kanban',
  objectName: 'tasks',
  groupBy: 'status',
  titleField: 'name',
};

/** Both at once, as the precedence rule (`cardTitle || titleField`) presumes possible. */
export const BOTH_SPELLINGS_BOARD: TsObjectKanbanSchema = {
  type: 'object-kanban',
  objectName: 'tasks',
  groupBy: 'status',
  cardTitle: 'name',
  titleField: 'subject',
};

/**
 * ⭐ The TS twin's OWN failing instrument, and the reason this file needs one.
 *
 * The zod declaration is pinned by the runtime rows above. The TypeScript twin was
 * NOT, when this was written: measured by ablation on that tree, deleting
 * `cardTitle?: string` from the `ObjectKanbanSchema` interface left
 * `pnpm --filter @object-ui/types type-check` at EXIT 0, the zod-mirror-parity
 * ratchet included — structural, not a threshold. (Re-measured with objectui#8347:
 * the same deletion now reddens the fresh literals above, the `_CardTitle…` row
 * below, and the ratchet's mirrored-undeclared ledger, which gained that direction
 * since.) Filed and re-derived from the ratchet's own source as objectui#9711;
 * its three operators were blind here for three DIFFERENT reasons, which is worth
 * stating because the obvious single explanation is wrong:
 *
 *   - `WiderThanDeclaredKeys` maps over `MirroredKeys` intersected with
 *     `DeclaredKeys`, so a key the twin does not declare simply LEAVES the key
 *     set — blind by omission.
 *   - `NarrowerThanDeclared` maps over `MirroredKeys` intersected with `keyof D`
 *     — `keyof D`, not `DeclaredKeys` — and `keyof D` was absorbed by
 *     {@link BaseSchema}'s `[key: string]: any` when this was measured, so the
 *     compared type was `any` and every mirror fit it. This was the ONLY
 *     operator the index signature explained (since objectui#8347 `keyof D` is
 *     literal, so it leaves an undeclared key out, blind by omission like the
 *     first); ⛔ it did not explain the other two, and `DeclaredKeys` itself
 *     is index-signature-free by construction (`WithoutIndexSignature`).
 *   - `UnmirroredDeclaredKeys` measures the OPPOSITE subtraction,
 *     declared-but-unmirrored.
 *
 * ⇒ the file already closed this failure mode by name for one direction — that
 * is what objectui#6058 measured and what `UnmirroredDeclaredKeys` was added for
 * — and its reverse has no counterpart operator. ⛔ So "the ratchet keeps the
 * twin honest" is not a claim this repository's instruments support in THAT
 * direction; the twin is declared because it is the PUBLISHED `.d.ts` surface an
 * author's editor reads, and this directive is what makes that declaration
 * measurable.
 *
 * The directive is REAL enforcement of the member's TYPE: with the member
 * declared, `42` is not assignable to `string | undefined` and the error it
 * expects exists. When written, deleting the member let the index signature
 * admit the `42`, the expected error disappeared, and `tsc` reddened with TS2578
 * — measured both ways. Since objectui#8347 a deleted member's `42` is refused
 * as an undeclared key, so the directive stays used and no longer sees a
 * deletion. The deletion guard is the `_CardTitleIsADeclaredString` row below:
 * an indexed access on a member that does not exist is itself a compile error,
 * and the row also pins the member's declared type. (The fresh literals above
 * refuse an undeclared `cardTitle` too, by the same excess-property check.)
 */
export const NON_STRING_CARD_TITLE_IS_REFUSED_AT_COMPILE_TIME: TsObjectKanbanSchema = {
  type: 'object-kanban',
  objectName: 'tasks',
  groupBy: 'status',
  // @ts-expect-error — `cardTitle` names a record FIELD, so a number cannot be one.
  // This is the compile-time half of the runtime refusal pinned above.
  cardTitle: 42,
};

/** Neither — both members are OPTIONAL on both faces, so the two faces agree on this board too. */
export const NEITHER_SPELLING_BOARD: TsObjectKanbanSchema = {
  type: 'object-kanban',
  objectName: 'tasks',
  groupBy: 'status',
};

/* ── Type-level: the members EXIST, with their declared type ───────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * The deletion guard on the TS twin (objectui#8347 silenced the TS2578 one):
 * `TsObjectKanbanSchema['cardTitle']` stops compiling the moment the member is
 * deleted, and `Equal` fails the moment it is re-typed. Measured by ablation on
 * this tree: deleting `cardTitle?: string` from the interface turns this row
 * red (beside the two fresh literals above and the `zod-mirror-parity` ledger,
 * since the zod twin still declares the member); restored, it is green. The
 * alias row is the type-level half of the third pin: reddening it means
 * `titleField` was retired, which the ruling forbids.
 */
export type _CardTitleIsADeclaredString = Expect<Equal<TsObjectKanbanSchema['cardTitle'], string | undefined>>;
export type _TitleFieldAliasIsStillDeclared = Expect<Equal<TsObjectKanbanSchema['titleField'], string | undefined>>;

describe('the TS face admits what the zod face admits (objectui#9606)', () => {
  it.each([
    ['the canonical spelling', CANONICAL_BOARD],
    ['the legacy alias', LEGACY_BOARD],
    ['both spellings', BOTH_SPELLINGS_BOARD],
    ['neither spelling', NEITHER_SPELLING_BOARD],
  ])('the annotated board with %s also parses', (_name, doc) => {
    expect(reasons(doc)).toEqual([]);
  });
});
