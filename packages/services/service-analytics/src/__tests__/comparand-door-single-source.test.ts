// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8186] `service-analytics` sources its comparand-TYPE membership from the
 * shared door (#7872) instead of spelling it a third time — and this file is the
 * evidence that doing so changed no verdict.
 *
 * ## What this file is FOR
 *
 * #8186 is a drift-risk reconciliation, not a defect: `comparand-shape.ts`'s two
 * predicates had reached the SAME six types as `isAcceptedFilterComparand`
 * (`@objectstack/spec/data`) independently, so the reconciliation had to be
 * provably verdict-neutral rather than merely plausible. The table below was
 * MEASURED on `origin/main` @ `84cb121eb` (before the predicates were rewired),
 * frozen here, and re-run unchanged afterwards. Both runs are green, which is
 * the whole claim: the membership moved, the behaviour did not.
 *
 * That is also why the matrix drives the two DOORS end to end and not only the
 * predicates. A predicate-level assertion would have proved the functions agree
 * with themselves; what a caller experiences is the door's verdict, envelope
 * included, and those are the cells a silent regression would move.
 *
 * ## The three positions, per door
 *
 * A comparand's legality is positional, so one value is asked three questions:
 * the LIKE family (needs a faithful TEXT rendering), an `$in` MEMBER (needs to
 * BIND), and a scalar `$eq` (the #5234 account deliberately left alone). The two
 * doors answer in different envelopes on purpose — a caller-authored `where` is
 * a 400 `INVALID_FILTER`, a read scope fails closed with a 500 (ADR-0021 D-C) —
 * so the envelope is asserted, not just the throw.
 *
 * ## The two rows that are NOT the door's set, and stay that way
 *
 * `undefined` and binary are `service-analytics`-local admissions at the
 * predicate level, exactly as they are `driver-sql`-local there. Neither is
 * reachable as an ACCEPTED comparand through either door:
 *
 *   - **`undefined` is REFUSED by both doors** — `assertDefinedComparands`
 *     (#6386, on #6050's ruling B) at the `where` door and #6125's upstream
 *     refusal at the read scope, both of which fire before a predicate is
 *     consulted. The `undefined` arms inside the predicates, and `comparand()`'s
 *     normalise-to-`null`, survive as deliberately-kept dead arms (#5526's call
 *     to reopen, not this card's). The `undefined` row below is what makes that
 *     checkable instead of asserted — it pins REFUSAL, at both doors.
 *   - **binary** binds but has no faithful text rendering, so it is accepted in
 *     a bind position and refused by the LIKE family. That asymmetry is the
 *     reason the package carries two predicates rather than one with a flag.
 *     [#20018] On the READ-SCOPE door it is now refused in every position: the
 *     lowering runs the shared comparand-type face after its own gates, as the
 *     ObjectQL execute face does. The predicate's own answer is unchanged.
 *
 * @see comparand-shape.ts — the predicates and the messages this pins
 * @see https://github.com/objectstack-ai/objectstack/issues/8186
 * @see https://github.com/objectstack-ai/objectstack/issues/7872 (the door)
 */

import { describe, it, expect } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import {
  isAcceptedFilterComparand,
  ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE,
} from '@objectstack/spec/data';

import { normalizeAnalyticsFilterTree } from '../strategies/filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import {
  isBindableComparand,
  isRenderableTextComparand,
  unbindableListMemberMessage,
  unrenderableTextComparandMessage,
} from '../comparand-shape.js';

const tree = (where: unknown) => normalizeAnalyticsFilterTree({ where } as any);
const scope = (where: unknown) => compileScopedFilterToSql(where as FilterCondition, 'person');

/** `'accept'`, or the refusal's ADR-0112 envelope as `CODE/status`. */
function verdict(run: () => unknown): string {
  try {
    run();
    return 'accept';
  } catch (e) {
    const err = e as { code?: string; status?: number };
    return `${err.code ?? 'NO_CODE'}/${err.status ?? 'NO_STATUS'}`;
  }
}

const REFUSED_WHERE = 'INVALID_FILTER/400';
const REFUSED_SCOPE = 'READ_SCOPE_COMPILE_FAILED/500';
const OK = 'accept';

interface Row {
  /** What the value IS, for the failure message. */
  readonly label: string;
  readonly value: unknown;
  /** `isBindableComparand` / `isRenderableTextComparand`. */
  readonly bindable: boolean;
  readonly renderable: boolean;
  /** `where` door: `{$contains: V}`, `{$in: [V]}`, `{$eq: V}`. */
  readonly whereLike: string;
  readonly whereIn: string;
  readonly whereEq: string;
  /** read-scope door, same three positions. */
  readonly scopeLike: string;
  readonly scopeIn: string;
  readonly scopeEq: string;
}

/**
 * Measured on `origin/main` @ `84cb121eb`, before any part of #8186 landed.
 *
 * The first six rows are the door's six accepted types — every one of them
 * ACCEPTED in every position on both doors, which is the byte-for-byte agreement
 * #8186 was filed on. `bigint` is among them, and was already accepted here
 * before this card: the refusal SENTENCES were the things that omitted it.
 */
const MATRIX: readonly Row[] = [
  // ── the door's six accepted types ──────────────────────────────────────────
  { label: 'string', value: 'x',
    bindable: true, renderable: true,
    whereLike: OK, whereIn: OK, whereEq: OK, scopeLike: OK, scopeIn: OK, scopeEq: OK },
  { label: 'number', value: 5,
    bindable: true, renderable: true,
    whereLike: OK, whereIn: OK, whereEq: OK, scopeLike: OK, scopeIn: OK, scopeEq: OK },
  { label: 'bigint', value: 9n,
    bindable: true, renderable: true,
    whereLike: OK, whereIn: OK, whereEq: OK, scopeLike: OK, scopeIn: OK, scopeEq: OK },
  { label: 'boolean', value: true,
    bindable: true, renderable: true,
    whereLike: OK, whereIn: OK, whereEq: OK, scopeLike: OK, scopeIn: OK, scopeEq: OK },
  // [#20010] One cell of this row moved AFTER the #8186 measurement, on
  // purpose: the `where` door now hands every field entry to the shared
  // comparand-shape face, whose 2026-08-31 ruling (#13357) refuses "a `null`
  // member of `$in` / `$nin`" at that door, for every driver. The object
  // spelling used to compile it to `status IN (NULL)`; the FilterArray
  // spelling was already refused (`where-face-arms-refusal.test.ts`). The
  // read-scope cell is that door's own and is not this card's.
  // [#20018] …and the read-scope cell moved too, by the same ruling at the
  // other door: the read-scope lowering now runs the shared list-shape face
  // after its own gates, so a `null` MEMBER of `$in` is refused there as the
  // ObjectQL execute face already refused it
  // (`read-scope-comparand-three-faces.test.ts`). `null` as a scalar or LIKE
  // comparand is not a list member and moves at neither door.
  { label: 'null', value: null,
    bindable: true, renderable: true,
    whereLike: OK, whereIn: REFUSED_WHERE, whereEq: OK, scopeLike: OK, scopeIn: REFUSED_SCOPE, scopeEq: OK },
  { label: 'Date', value: new Date('2026-01-01T00:00:00.000Z'),
    bindable: true, renderable: true,
    whereLike: OK, whereIn: OK, whereEq: OK, scopeLike: OK, scopeIn: OK, scopeEq: OK },

  // ── the two package-local predicate admissions, neither reachable ──────────
  // `undefined`: the predicates admit it; BOTH doors refuse it upstream (#6386
  // at the `where` door, #6125 at the read scope) before a predicate is asked.
  { label: 'undefined', value: undefined,
    bindable: true, renderable: true,
    whereLike: REFUSED_WHERE, whereIn: REFUSED_WHERE, whereEq: REFUSED_WHERE,
    scopeLike: REFUSED_SCOPE, scopeIn: REFUSED_SCOPE, scopeEq: REFUSED_SCOPE },
  // binary: binds, does not render — accepted where it binds, refused by LIKE.
  // [#20018] Two cells moved AFTER the #8186 measurement, on purpose: the
  // read-scope lowering now runs the shared comparand-type face after its own
  // gates, and that face does not admit binary (the predicate above it still
  // does — the `where` door keeps the extra, the read scope no longer reaches
  // it). The ObjectQL execute face already refused a binary read-scope
  // comparand.
  { label: 'binary', value: new Uint8Array([1, 2]),
    bindable: true, renderable: false,
    whereLike: REFUSED_WHERE, whereIn: OK, whereEq: OK,
    scopeLike: REFUSED_SCOPE, scopeIn: REFUSED_SCOPE, scopeEq: REFUSED_SCOPE },

  // ── shapes outside the fence ──────────────────────────────────────────────
  // `$eq` accepts them on purpose: #5234 left the `{$eq: {…}}` account alone.
  // [#20018] …on the `where` door. On the read-scope lowering the shared
  // comparand-type face now closes that account (#7872's set), the answer the
  // ObjectQL execute face already gave: a plain object bound as a scalar was
  // refused by the database at execution, not by this package.
  { label: 'plain object', value: { foo: 1 },
    bindable: false, renderable: false,
    whereLike: REFUSED_WHERE, whereIn: REFUSED_WHERE, whereEq: OK,
    scopeLike: REFUSED_SCOPE, scopeIn: REFUSED_SCOPE, scopeEq: REFUSED_SCOPE },
  // [#19975] One cell of this row moved AFTER the #8186 measurement, on
  // purpose: ruling 乙 (#19757) refuses a list in the equality slot, and the
  // read-scope lowering now refuses it under `$eq` instead of binding the list
  // as one parameter (`read-scope-eq-array-refusal.test.ts`).
  // [#19888] And the `where` door's `$eq` cell, for the same ruling: the list
  // is handed to the shared face's equality arm and refused INVALID_FILTER /
  // 400, where it used to compile to `qty = 'al'` with `'be'` dropped in
  // silence (`where-equality-slot-list-refusal.test.ts`).
  { label: 'array', value: ['al', 'be'],
    bindable: false, renderable: false,
    whereLike: REFUSED_WHERE, whereIn: REFUSED_WHERE, whereEq: REFUSED_WHERE,
    scopeLike: REFUSED_SCOPE, scopeIn: REFUSED_SCOPE, scopeEq: REFUSED_SCOPE },
  // A `$field` scalar comparand is SERVED on the `where` door since the
  // 2026-08-12 ruling (NativeSQLStrategy declines, the engine path runs it) and
  // refused by the read-scope lowering, which cannot honestly render it (#7598).
  { label: 'field reference', value: { $field: 'other' },
    bindable: false, renderable: false,
    whereLike: REFUSED_WHERE, whereIn: REFUSED_WHERE, whereEq: OK,
    scopeLike: REFUSED_SCOPE, scopeIn: REFUSED_SCOPE, scopeEq: REFUSED_SCOPE },
];

describe('[#8186] the comparand matrix is unchanged by the door reconciliation', () => {
  describe('the two predicates', () => {
    for (const row of MATRIX) {
      it(`\`${row.label}\` — bindable=${row.bindable}, renderable=${row.renderable}`, () => {
        expect(isBindableComparand(row.value)).toBe(row.bindable);
        expect(isRenderableTextComparand(row.value)).toBe(row.renderable);
      });
    }
  });

  describe('the analytics `where` door, three positions', () => {
    for (const row of MATRIX) {
      it(`\`${row.label}\` — $contains=${row.whereLike}, $in=${row.whereIn}, $eq=${row.whereEq}`, () => {
        expect(verdict(() => tree({ name: { $contains: row.value } }))).toBe(row.whereLike);
        expect(verdict(() => tree({ status: { $in: [row.value] } }))).toBe(row.whereIn);
        expect(verdict(() => tree({ qty: { $eq: row.value } }))).toBe(row.whereEq);
      });
    }
  });

  describe('the read-scope lowering, the same three positions', () => {
    for (const row of MATRIX) {
      it(`\`${row.label}\` — $contains=${row.scopeLike}, $in=${row.scopeIn}, $eq=${row.scopeEq}`, () => {
        expect(verdict(() => scope({ name: { $contains: row.value } }))).toBe(row.scopeLike);
        expect(verdict(() => scope({ status: { $in: [row.value] } }))).toBe(row.scopeIn);
        expect(verdict(() => scope({ qty: { $eq: row.value } }))).toBe(row.scopeEq);
      });
    }
  });

  /**
   * The half of #8186 the matrix above cannot see.
   *
   * The matrix pins that behaviour did not MOVE, which is exactly as true of a
   * local re-spelling as of the door import — that is what "the copies agree
   * byte-for-byte" means. So these assertions pin the other direction: the
   * membership and the sentence are the DOOR's, so a future change to the door
   * reaches this package instead of silently disagreeing with it. Re-spell
   * either one locally and these go red while the matrix stays green.
   */
  describe('the membership and the sentence are the door’s, not a local copy', () => {
    const EVERY_VALUE = [
      ...MATRIX.map((r) => r.value),
      -1.5, 0, '', false, 9007199254740993n, new Map(), Symbol('s'), () => 1, [],
    ];

    it('`isRenderableTextComparand` is exactly the door plus `undefined`', () => {
      for (const v of EVERY_VALUE) {
        expect(isRenderableTextComparand(v), String(typeof v)).toBe(
          v === undefined || isAcceptedFilterComparand(v),
        );
      }
    });

    it('`isBindableComparand` is exactly the door plus `undefined` and binary', () => {
      for (const v of EVERY_VALUE) {
        expect(isBindableComparand(v), String(typeof v)).toBe(
          v === undefined || isAcceptedFilterComparand(v) || ArrayBuffer.isView(v),
        );
      }
    });

    it('both refusal messages quote the door’s sentence rather than a hand copy', () => {
      expect(unbindableListMemberMessage('$in', 'status', { foo: 1 }, 0))
        .toContain(ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE);
      expect(unrenderableTextComparandMessage('$contains', 'name', { foo: 1 }))
        .toContain(ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE);
    });

    it('the sentence names `bigint`, which the old hand copy omitted', () => {
      // Not a new capability: `bigint` is accepted in the matrix above and was
      // before this card too. The copied sentence simply under-described the
      // set it was copied from, which is the failure mode of copying it.
      expect(ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE).toContain('bigint');
      expect(unbindableListMemberMessage('$in', 'status', { foo: 1 }, 0)).toContain('bigint');
      expect(isBindableComparand(9n)).toBe(true);
    });

    it('binary stays a package-local extra the door does not admit', () => {
      const buf = new Uint8Array([1, 2]);
      expect(isAcceptedFilterComparand(buf)).toBe(false);
      expect(isBindableComparand(buf)).toBe(true);
      expect(unbindableListMemberMessage('$in', 'status', { foo: 1 }, 0))
        .toContain('(or a binary value)');
    });
  });

  it('every one of the door’s six accepted types is accepted in every position', () => {
    // Stated as its own assertion because it is the sentence #8186 rests on:
    // the copies AGREE with the door, so reconciling them may move no cell.
    const doorTypes = MATRIX.slice(0, 6);
    expect(doorTypes.map((r) => r.label)).toEqual([
      'string', 'number', 'bigint', 'boolean', 'null', 'Date',
    ]);
    // The cells a SHAPE ruling moved, not a TYPE verdict: `null` is an accepted
    // comparand type, but not as an `$in` MEMBER — the shared shape face's
    // 2026-08-31 carve-out, now run at BOTH doors. Every cell is named with the
    // change that moved it, so no other cell can move under this sentence.
    const moved: Record<string, string> = {
      'null whereIn': REFUSED_WHERE, // [#20010] the `where` door's envelope
      'null scopeIn': REFUSED_SCOPE, // [#20018] the read-scope lowering's envelope
    };
    for (const row of doorTypes) {
      const cells = {
        whereLike: row.whereLike, whereIn: row.whereIn, whereEq: row.whereEq,
        scopeLike: row.scopeLike, scopeIn: row.scopeIn, scopeEq: row.scopeEq,
      };
      for (const [position, cell] of Object.entries(cells)) {
        const key = `${row.label} ${position}`;
        expect(cell, key).toBe(moved[key] ?? OK);
      }
    }
  });
});
