/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `buildConflict` consumes the narrowing it is handed (objectui#6477).
 *
 * `InlineEditSaveBar` narrows correctly at the call site —
 * `if (isConcurrentUpdateError(err) && canAtomic)` — and then used to hand the
 * narrowed value to a callback whose parameter was `err: any`, which discards
 * it. The predicate's return type was inert at its only in-repo consumer, one
 * line after the boundary was drawn. objectui#6421 / PR #6474 had just made
 * that return type honest (`code?: 'CONCURRENT_UPDATE'`, optional because the
 * `name` limb carries no `code`); this card is why anything listens to it.
 *
 * The measurement that picked this answer over "keep the `any` and write down
 * why": `buildConflict` reads exactly TWO things off `err` — `currentRecord`
 * and `currentVersion` — and the narrowed type declares both, at types the
 * `ConcurrentUpdateConflict` payload accepts unchanged. Nothing forced the
 * `any`, so it went.
 *
 * WHAT EACH PIN BELOW IS FOR, labelled the way the sibling
 * `ConcurrentUpdateDialog.narrowedCode-6421.test.tsx` labels its own, because
 * a pin that also passes against `origin/main` proves nothing about this
 * change:
 *
 *  - DISAGREES — red before this change, green after.
 *  - CONTROL — passes both ways ON PURPOSE, naming the future wrong shape it
 *    exists to catch, so the DISAGREES pins cannot pass vacuously.
 *
 * KNOWN RESIDUAL, stated rather than papered over: these pins bite on the
 * exported `BuildConflict` type, which the component applies via
 * `React.useCallback<BuildConflict>`. A revert that deleted the generic AND
 * re-annotated the lambda `err: any` would leave `BuildConflict` correct but
 * unused, and this file would stay green. Nothing reachable from a test can
 * observe a callback local to a component body; the runtime block below is
 * what covers that flank, by driving the real component through a real 409.
 *
 * The compile-time half is ERASED at runtime — vitest proves nothing about it.
 * `tsc -p packages/plugin-detail/tsconfig.test.json`, chained off this
 * package's `type-check` script, is the only thing that checks it, and it
 * reads `../InlineEditSaveBar` as SOURCE (a relative import), never through a
 * built `dist/*.d.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { InlineEditSaveBar, type BuildConflict } from '../InlineEditSaveBar';
import {
  isConcurrentUpdateError,
  type ConcurrentUpdateConflict,
} from '../ConcurrentUpdateDialog';

/* -------------------------------------------------------------------------- */
/* Compile-time pins                                                           */
/*                                                                             */
/* `Assert<false>` is a TS2344 "does not satisfy the constraint 'true'" error,  */
/* so a false verdict is a red build, not a skipped assertion.                 */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;
/** `any` is the one type that is BOTH assignable to and from `1 & T`. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The type a `x is T` predicate narrows to — `never` if it stopped being one. */
type NarrowedBy<F> = F extends (arg: unknown) => arg is infer N ? N : never;

type Narrowed = NarrowedBy<typeof isConcurrentUpdateError>;
type ErrParam = Parameters<BuildConflict>[1];

// CONTROL (passes both ways) — the predicate is still a live, exported type
// predicate over `unknown`. Guards a future change to a bare `boolean` return
// (like `plugin-form`'s copy), which collapses `Narrowed` to `never` — and
// `never` is assignable to everything, so it would satisfy every pin below in
// silence.
type _PredicateStillNarrows = Assert<Equal<IsNever<Narrowed>, false>>;

// CONTROL (passes both ways) — `buildConflict` is still the binary callback
// returning the dialog's payload. Guards a refactor that reshapes the callback
// out from under the pins rather than reverting them.
type _StillABinaryCallback = Assert<Equal<Parameters<BuildConflict>['length'], 2>>;
type _StillReturnsTheConflictPayload = Assert<
  Equal<ReturnType<BuildConflict>, ConcurrentUpdateConflict>
>;
type _DraftParamUnchanged = Assert<Equal<Parameters<BuildConflict>[0], Record<string, any>>>;

// DISAGREES — the error parameter is not `any`. This is the card's whole
// subject stated in one line: `Equal` distinguishes `any` from every other
// type, so this is red the moment the parameter goes back.
type _ErrParamIsNotAny = Assert<Equal<IsAny<ErrParam>, false>>;

// DISAGREES — and it is not merely "some type", it is EXACTLY what the
// predicate narrows to. Guards the near-miss fix: a hand-restated literal
// shape that starts out identical and drifts the first time the predicate
// changes. The alias in the source is derived from the predicate precisely so
// this equality cannot rot.
type _ErrParamIsTheNarrowedType = Assert<Equal<ErrParam, Narrowed>>;

// DISAGREES — the two reads `buildConflict` performs are covered by the
// narrowed type, at types the conflict payload takes UNCHANGED. This pair is
// also the standing proof that the `as Record<string, unknown> | null` cast
// this change deleted was genuinely redundant: if these ever go red, the two
// shapes have started to disagree and the cast was hiding it.
type _CurrentRecordReadIsCovered = Assert<
  Extends<Narrowed['currentRecord'], ConcurrentUpdateConflict['currentRecord']>
>;
type _CurrentVersionReadIsCovered = Assert<
  Extends<Narrowed['currentVersion'], ConcurrentUpdateConflict['currentVersion']>
>;

/* -------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* -------------------------------------------------------------------------- */

function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('status')}>edit-enter</button>
      <button onClick={() => inline.setField('status', 'active')}>edit-status</button>
    </>
  );
}

describe('buildConflict reads the narrowed payload off a name-only 409', () => {
  // CONTROL (passes both ways) — pins the SHAPE of the two reads end-to-end, on
  // the `name` limb specifically: the sibling test in `InlineEditSaveBar.test`
  // covers the `code` limb, so until now nothing proved a code-less error
  // reaches `buildConflict` at all. If a future narrowing stops covering
  // `currentRecord` / `currentVersion` and someone "resolves" the red build by
  // deleting the read instead of fixing the type, this goes red.
  it('carries currentRecord and currentVersion through to the dialog', async () => {
    const update = vi.fn().mockRejectedValue({
      name: 'ConcurrentUpdateError',
      message: 'record changed underneath',
      currentVersion: '2026-08-26 10:30:00.000',
      currentRecord: { status: 'taken' },
    });

    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="proj"
          recordId="p1"
          data={{ updated_at: 'v1' }}
          refresh={vi.fn()}
        />
      </InlineEditProvider>,
    );

    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-status'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole('alertdialog');

    // `currentRecord` was read: the single-field draft renders the racer's
    // value for that field as the "current value" half of the diff.
    expect(dialog.textContent).toContain('taken');
    // ...against the user's pending edit, so the assertion above is a real
    // read of the server record and not an echo of the draft.
    expect(dialog.textContent).toContain('active');
    // `currentVersion` was read: with no `updated_at` on the racer record the
    // dialog falls back to it for the audit line. Asserted on the year rather
    // than the formatted string, which is locale-dependent.
    expect(dialog.textContent).toMatch(/2026/);
  });

  // CONTROL (passes both ways) — the witness above really is code-less, so the
  // pins describe the limb they claim to. Without this, a runtime that quietly
  // stopped accepting name-only errors would make the block above a statement
  // about an unreachable branch.
  it('the witness is accepted by the predicate and carries no `code`', () => {
    const nameOnly = {
      name: 'ConcurrentUpdateError',
      message: 'record changed underneath',
      currentVersion: '2026-08-26 10:30:00.000',
      currentRecord: { status: 'taken' },
    };
    expect(isConcurrentUpdateError(nameOnly)).toBe(true);
    expect((nameOnly as { code?: unknown }).code).toBeUndefined();
  });
});
