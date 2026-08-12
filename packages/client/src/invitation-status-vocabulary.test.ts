// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7781 — `organizations.invitations.list()` hand-wrote its row `status` as
// `'pending' | 'accepted' | 'rejected' | 'canceled'`, missing `expired`
// (ObjectStack's own terminal state, driven by `expiresAt`). `listMine()` was
// worse: a bare `string`. Both are two more hand-copied spellings of the
// vocabulary `InvitationStatus` (`@objectstack/spec/identity`) already owns —
// same divergence family as #7726, which had already widened the spec side to
// five values (adding `canceled`) while this file stayed at four and drifted
// the other way.
//
// The fix types both methods FROM `InvitationStatus` rather than restating it
// (see `organizations.invitations.{list,listMine}` in `./index.ts`), so a
// future value added to the spec enum reaches the SDK by construction. This
// file is the pin that makes a REGRESSION — someone re-literalizing either
// method, or the spec enum moving without the (already-derived) client
// following — a compile failure instead of a silent third divergence.
//
// Note WHY this is a type-level (`tsc`) pin and not a runtime one: the defect
// was entirely inside a type annotation over a `JSON.parse` cast. The value
// arrives off the wire regardless of what the annotation says (see #7781's
// own "Impact" section) — no input you could feed a running client would ever
// make a purely-runtime test fail here. The `Eq<...>` comparison below is
// against `InvitationStatus` ITSELF, never a second hand-written literal that
// happens to agree today; the runtime `describe` block below is a companion
// that pins the enum's actual content in prose, for a reader who is not
// re-deriving the type by eye.
//
// Exported at module scope (not inside `it()`): an unread alias in a function
// body is TS6196 under `noUnusedLocals`, and — the part that matters — a pin
// no program compiles is a phantom check that stays green after the guarded
// code is deleted. `pnpm --filter @objectstack/client typecheck` (which runs
// `tsc --noEmit` over `src/**/*` via `tsconfig.test.json`) is the gate that
// reads this file; `vitest` does not type-check (#4311) and only runs the
// `describe` block.
import { describe, it, expect } from 'vitest';
import type { InvitationStatus } from '@objectstack/spec/identity';
import { InvitationStatus as InvitationStatusSchema } from '@objectstack/spec/identity';
import type { ObjectStackClient } from './index';

/** Type-level identity helper — same shape as the spec package's pin tests. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Assert< T extends true > = T;

type ListInvitationsResult = Awaited< ReturnType< ObjectStackClient[ 'organizations' ][ 'invitations' ][ 'list' ] > >;
type ListMineResult = Awaited< ReturnType< ObjectStackClient[ 'organizations' ][ 'invitations' ][ 'listMine' ] > >;

type ListRowStatus = ListInvitationsResult[ 'invitations' ][ number ][ 'status' ];
type ListMineRowStatus = ListMineResult[ 'invitations' ][ number ][ 'status' ];

/**
 * `list()`'s declared row `status` IS `InvitationStatus` — not a literal union
 * that merely lists the same values today. A re-literalization (even one that
 * currently agrees) or a spec-side change this file's import does not follow
 * makes `Eq` evaluate `false`, and `Assert< false >` fails to compile.
 */
export type ListStatusIsTheSpecUnion = Assert< Eq< ListRowStatus, InvitationStatus > >;

/** Same requirement for `listMine()`, which was a bare `string` before #7781. */
export type ListMineStatusIsTheSpecUnion = Assert< Eq< ListMineRowStatus, InvitationStatus > >;

describe('#7781 organizations.invitations — status vocabulary parity with the spec enum', () => {
  it('the spec enum currently carries exactly the five shipped values, in this order', () => {
    // Runtime companion to the type-level pin above: this is the CONTENT a
    // non-TypeScript reader can check without reading compiler output. Order
    // matters here only in that it documents what's live, not because either
    // consuming SELECT depends on enum declaration order.
    expect([...InvitationStatusSchema.options]).toEqual([
      'pending',
      'accepted',
      'rejected',
      'expired',
      'canceled',
    ]);
  });

  it('every value the SDK previously hand-listed is a real spec value', () => {
    // Reverse of the card's headline complaint: the pre-fix literal was
    // `'pending' | 'accepted' | 'rejected' | 'canceled'` — checking here that
    // none of those four is dead SDK-only surface the platform never emits.
    for (const value of ['pending', 'accepted', 'rejected', 'canceled'] as const) {
      expect(InvitationStatusSchema.options).toContain(value);
    }
  });

  it('refuses a value outside the vocabulary', () => {
    expect(InvitationStatusSchema.safeParse('cancelled').success).toBe(false);
  });
});
