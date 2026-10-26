/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The two LOCAL mirrored-but-undeclared keys, measured per key (objectui#9729).
 *
 * ## What this file is, and ⛔ what it is not
 *
 * `MirroredUndeclared` in `zod-mirror-parity.test.ts` measures the DIRECTION —
 * a key the zod mirror states and the TypeScript twin does not — and reconciles
 * it per pair. It deliberately says nothing about what each key DOES, because
 * the remedy is a contract decision: declaring the key on the twin ENLARGES the
 * published TypeScript accept set, narrowing the mirror SHRINKS the published
 * validator's, and both move a face `@object-ui/types` already ships.
 *
 * ⛔ This file did not pick either direction, and it is ⛔ not a repair. It is
 * the per-key CONSEQUENCE the ledger's one-line entries cannot carry, recorded
 * so the at-tier contract review can read it instead of re-deriving it. Every
 * assertion below is a statement about `origin/main` as it stands; whichever
 * direction the review rules, the entries here move with it.
 *
 * ⭐ BOTH KEYS HAVE NOW BEEN RULED, and this file moved with each of them exactly
 * as the paragraph above promised — in OPPOSITE directions, which is the thing to
 * read here before assuming one ruling generalises to the other.
 *
 *   - `operators` — objectui#9739 (maintainer, 2026-09-18) took letter C:
 *     removed from the published mirror, a tombstone left in its place that
 *     refuses the key by name and names the spelling the upstream protocol
 *     declares. So the `operators` section below no longer pins a SILENT
 *     ACCEPTANCE — it pins the LOUD REFUSAL that replaced it, and the lit
 *     control beside it is what keeps the assertion honest in its new
 *     direction. The full per-half measurement, including the upstream
 *     re-derivation of the spelling the message names, lives in
 *     `object-grid-operators-tombstone-9739.test.ts`.
 *   - `dueLike` — objectui#9738 (maintainer, 2026-09-18) took letter A: the
 *     key is DECLARED on the published TypeScript twin, so the validator, the
 *     type checker, the renderer and the docs now say the same thing. The
 *     mirror is ⛔ untouched — it already stated the key — so the section below
 *     that measures the mirror is unchanged, and it is the TypeScript half at
 *     the bottom of this file that inverted.
 *     ⚠️ Dated note (objectui#11815, ruling D): the key has since RETIRED
 *     from both faces — the deadline is the object field's declaration, read
 *     through enrichment — so both `dueLike` sections below now pin its
 *     absence.
 *
 * What stays, in both cases, is the BEFORE/AFTER continuity, so neither defect
 * this card measured can quietly return under the same name.
 *
 * ## The two keys do NOT behave the same way, and the difference is the ruling
 *
 * Both twins are hand-written interfaces, but only one of them can REFUSE:
 *
 *   - `DetailViewField` carried no index signature, so TypeScript rejected an
 *     authored `dueLike` outright (`TS2353`). The two published faces therefore
 *     actively CONTRADICTED each other: the validator judged the key and kept
 *     it, the compiler refused the same document. ⭐ That was the loud defect,
 *     and it was ruled letter A (objectui#9738): the twin DECLARES the key now,
 *     so the accept set of the published TypeScript face widened by exactly one
 *     key and the contradiction is closed in the direction that keeps the
 *     renderer's behaviour. It still carries no index signature — which is what
 *     keeps the assignment at the bottom of this file a real assertion.
 *   - `ObjectGridSchema` extends `BaseSchema`, whose `[key: string]: any` index
 *     signature absorbed any unstated key. TypeScript neither declared nor
 *     refused `operators`; it typed it `any`. The faces did not contradict —
 *     one was simply silent, which is a weaker defect and was a different
 *     decision. ⭐ It was decided (objectui#9739, letter C): the MIRROR now
 *     refuses the key by name and prints the upstream spelling, while the twin
 *     is deliberately left alone — so the two faces still do not contradict,
 *     but the silent one is no longer the only one an author hears from.
 *     ⚠️ Dated note (objectui#8347): `BaseSchema` no longer carries that index
 *     signature, so the twin refuses an authored `operators` too, as an
 *     undeclared key. Still not declared, still not tombstoned on the twin.
 *
 * ## ⚠️ The third key the ledger groups with these two is NOT this defect
 *
 * `complex.zod.ts#DashboardConfigSchema`'s `aria` is a `z.never()` retirement
 * tombstone: it REFUSES the key by name and prints a remedy. Its consequence is
 * the OPPOSITE of the two above — they admit silently, it rejects loudly — so a
 * sweep that treats the three alike would ask a maintainer to repair something
 * already doing its job. Pinned here as the CONTRAST, by re-deriving its shape
 * rather than by citing the reading.
 *
 * ## Every zero below carries a lit control on the same instrument
 *
 * A green `safeParse` proves nothing on its own: both mirrors accept unknown
 * keys (one strips them, the other keeps them unexamined). What distinguishes a
 * MIRRORED key from an unknown one is that the mirror JUDGES it — so each key's
 * pin is paired with an unrecognised-key control parsed through the same schema.
 */

import { describe, it, expect } from 'vitest';
import { DetailViewFieldSchema } from '../zod/views.zod.js';
import { ObjectGridSchema } from '../zod/objectql.zod.js';
import { DashboardConfigSchema } from '../zod/complex.zod.js';
import type { DetailViewField } from '../views.js';
import type { ObjectGridSchema as ObjectGridSchemaType } from '../objectql.js';

/** A control key no surface in this package declares. */
const UNKNOWN_KEY = 'zzzNotAKeyAnySurfaceDeclares9729';

describe('views.zod.ts#DetailViewFieldSchema — `dueLike`, retired by objectui#11815', () => {
  /**
   * ⭐ INVERTED BY RULING, ⛔ not relaxed. objectui#9738 letter A declared the
   * key on both faces; objectui#11815 (ruling D) retired it from the authored
   * view entry altogether: the deadline is the object FIELD's declaration
   * (`DateFieldMetadata.dueLike` / `settledWhen`, by reference to the spec),
   * read through `enrichDetailField`. So the mirror no longer judges the key —
   * it strips it exactly as it strips an unknown one, which the lit control
   * beside it shows is the same instrument answering.
   */
  it('the mirror no longer states the key, and strips it like an unknown one', () => {
    expect(Object.keys(DetailViewFieldSchema.shape)).not.toContain('dueLike');
    const retired = DetailViewFieldSchema.safeParse({ name: 'end_date', dueLike: true });
    expect(retired.success).toBe(true);
    expect(retired.success && Object.keys(retired.data)).not.toContain('dueLike');

    // LIT CONTROL, same schema: a key the mirror DOES state survives the parse.
    const control = DetailViewFieldSchema.safeParse({ name: 'end_date', currency: 'USD' });
    expect(control.success && control.data).toMatchObject({ currency: 'USD' });
    const unknown = DetailViewFieldSchema.safeParse({ name: 'end_date', [UNKNOWN_KEY]: true });
    expect(unknown.success && Object.keys(unknown.data)).not.toContain(UNKNOWN_KEY);
  });
});

describe('objectql.zod.ts#ObjectGridSchema — `operators`, after the objectui#9739 ruling', () => {
  /**
   * ⭐ THE DIRECTION OF THIS ASSERTION IS INVERTED FROM WHAT THIS CARD MEASURED,
   * deliberately and by ruling — ⛔ not relaxed to keep a suite green.
   *
   * What #9729 recorded here was a document that parsed GREEN and was then
   * ignored by every renderer: the worst shape a contract can have, because
   * both published faces report success. Letter C replaced it, so the pin
   * that recorded the silence would now be recording a defect that is gone.
   * Pinning the refusal in the same place, on the same document, is what keeps
   * the regression visible: if `operators` ever parses green on this node
   * again, this line is what goes red.
   */
  it('REFUSES the authored key that used to parse green, and the issue names it', () => {
    const judged = ObjectGridSchema.safeParse({
      type: 'object-grid',
      objectName: 'probe',
      operators: { name: ['equals'] },
    });
    expect(judged.success).toBe(false);
    expect(!judged.success && judged.error.issues.map((i) => i.path.join('.'))).toContain('operators');
  });

  it('the refusal is BY NAME — an unknown key on the same document is still kept unexamined', () => {
    // LIT CONTROL, unchanged from what this card measured: this mirror's base
    // passes unknown keys THROUGH. It is doing more work now than it did then.
    // Before, it separated "the mirror judges this key" from "the mirror keeps
    // anything"; now it separates "this KEY is refused" from "this OBJECT turned
    // strict" — which is a contract change nobody ruled and this control would
    // be the first thing to catch.
    const control = ObjectGridSchema.safeParse({
      type: 'object-grid',
      objectName: 'probe',
      [UNKNOWN_KEY]: 42,
    });
    expect(control.success).toBe(true);
  });

  it('a wrong-TYPED `operators` is refused too — the tombstone admits no value at all', () => {
    // The pre-ruling shape of this case asserted that the mirror type-checked
    // the key (42 was refused, an object was accepted). A tombstone collapses
    // that distinction: no value satisfies it. Kept as a case rather than
    // deleted, because the assertion it makes is no longer the same one.
    const judged = ObjectGridSchema.safeParse({
      type: 'object-grid',
      objectName: 'probe',
      operators: 42,
    });
    expect(judged.success).toBe(false);
    expect(!judged.success && judged.error.issues.map((i) => i.path.join('.'))).toContain('operators');
  });
});

describe('complex.zod.ts#DashboardConfigSchema — `aria` is the CONTRAST, not the defect', () => {
  it('REFUSES the key by name and names a remedy — the opposite consequence', () => {
    const r = DashboardConfigSchema.safeParse({ aria: { label: 'x' } });
    expect(r.success).toBe(false);
    const issue = !r.success ? r.error.issues.find((i) => i.path.join('.') === 'aria') : undefined;
    expect(issue).toBeDefined();
    // The remedy travels with the refusal. Asserted as the leading token rather
    // than the whole sentence: the wording is the contract here, the prose that
    // follows it is not.
    expect(String(issue?.message)).toContain('RETIRED');

    // LIT CONTROL on the same schema: an unrecognised key is NOT refused, so
    // the refusal above is BY NAME and not a strictness the whole object has.
    const control = DashboardConfigSchema.safeParse({ [UNKNOWN_KEY]: true });
    expect(control.success).toBe(true);
  });

  it('a document that omits the key stays green — a tombstone gates nothing else', () => {
    expect(DashboardConfigSchema.safeParse({ showHeader: true }).success).toBe(true);
  });
});

/* ── The TypeScript side, where the two keys stop behaving alike ───────────── */

/**
 * `DetailViewField` REFUSES `dueLike` since objectui#11815 (ruling D) retired
 * the authored view-entry key. This directive IS the assertion, read by the
 * package's `tsc -p tsconfig.test.json` leg: re-declaring the member makes it
 * unused (`TS2578`) on the same leg.
 */
// @ts-expect-error — objectui#11815: the deadline is the FIELD's declaration, not the view entry's
export const authoredDueLike: DetailViewField = { name: 'end_date', dueLike: true };

/** LIT CONTROL: a key the twin DOES declare is accepted on the same literal. */
export const authoredCurrency: DetailViewField = { name: 'end_date', currency: 'USD' };

/**
 * Invariant equality — `extends` both ways would accept a narrowing. Spelled
 * here rather than imported from `zod-mirror-parity.test.ts`, which exports the
 * same two lines: no test file in this package imports another, and a two-line
 * helper beside its single use is cheaper than establishing that it may.
 */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/** The member is gone from the twin, not merely made optional (objectui#11815). */
export type assertionDueLikeIsRetiredFromTheTwin =
  Expect< Equal< 'dueLike' extends keyof DetailViewField ? true : false, false > >;

/**
 * The TWIN refuses `operators` too since objectui#8347 removed `BaseSchema`'s
 * index signature. Before it, the absence of a `@ts-expect-error` here was the
 * measurement — this binding compiled through the signature — and this
 * docblock named the removal as the way that claim would fail. It failed as
 * named: the key is still NOT declared on the twin (below), so it is refused
 * as an undeclared key, with no name for the remedy; the mirror's tombstone
 * is what names `operations`.
 *
 * ⭐ Unchanged by objectui#9739 ON PURPOSE. Letter C rules the key "not declared
 * on the TypeScript twin" — declaring it was letter A, refused, on the ground
 * that it writes a misspelling into the published interface beside the correct
 * spelling. That ruling stands: the twin declares nothing for `operators`,
 * and both faces now refuse it, the mirror by name and the twin as undeclared.
 */
export const authoredOperators: ObjectGridSchemaType = {
  type: 'object-grid',
  objectName: 'probe',
  // @ts-expect-error — `operators` is not declared on the twin; since objectui#8347 an undeclared key is refused
  operators: { name: ['equals'] },
};

describe('the TypeScript twins', () => {
  it('are compiled by this package’s type-check leg, which is where the two directives above are read', () => {
    // The runtime here only keeps the three bindings alive; the assertions that
    // matter are the directives, and `tsc -p tsconfig.test.json` is the reader.
    expect([authoredDueLike, authoredCurrency, authoredOperators]).toHaveLength(3);
  });
});
