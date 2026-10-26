/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * recordInvalidation — how a record form reads the data-invalidation bus
 * (`notifyDataChanged` / `useDataInvalidation` from `@object-ui/react`), stated
 * ONCE for every layout `ObjectForm` routes to: its default arm (objectui#10572)
 * and `DrawerForm`, `ModalForm`, `SplitForm`, `TabbedForm` and `WizardForm`
 * (objectui#10715).
 *
 * The nonce moves on a change to the record the form reads, to its object as a
 * whole, or to `'*'` (the objectui#10494 way). A change scoped to another record
 * of the object does not move it, and a form that reads no record — create
 * mode, or no `recordId` — never subscribes.
 *
 * Unlike a list, a form holds the user's in-progress input, and a re-read
 * replaces the values the form renderer resets to BY VALUE and the OCC token a
 * save sends. So the re-read is GATED ON PRISTINE (the seat's ruling on the
 * objectui#10572 fork, option A):
 *   - pristine → `refetch` moves once, and the form's record read effect, which
 *     names it, re-reads in place (no loading branch, so no remount);
 *   - dirty → the change is HELD: the typed values and the OCC token the edit
 *     started from both stay, so a real conflict still surfaces at save through
 *     the conflict dialog; ONE re-read is replayed when the form is pristine
 *     again (the renderer's `onDirtyChange(false)` after a reset or a revert) or
 *     when this form's own save lands (`saved()`).
 *
 * Dirtiness comes from the form renderer's existing `onDirtyChange` channel. A
 * host with unsaved input the renderer cannot see (the wizard's steps already
 * submitted with Next) folds it into the value it passes. Nothing new is
 * declared on any schema.
 *
 * The re-read rides the form's OWN record read effect, so what already holds
 * there holds for it: a superseded read commits nothing (objectui#10712), a
 * failure is reported by the current run only (objectui#10682), and the loading
 * branch — keyed on a change of record — is not entered for the record already
 * on screen.
 *
 * `onDirtyChange` and `saved` are the same two functions for the life of the
 * component (a state value that is never set, closing over refs and a state
 * setter), so a host may name them in a dependency list without resting on a
 * memo's identity (AGENTS.md #10).
 */
import { useEffect, useRef, useState } from 'react';
import { useDataInvalidation } from '@object-ui/react';

export interface RecordInvalidation {
  /**
   * Bumped once per re-read this form decides to run. The record read effect
   * names it in its dependency list; nothing else reads it.
   */
  refetch: number;
  /**
   * The form renderer's `onDirtyChange`. A host with dirty state of its own
   * composes this with it; `false` replays a held re-read.
   */
  onDirtyChange: (dirty: boolean) => void;
  /**
   * This form's edit landed: what it shows is what the server holds. Clears
   * dirty and replays a held re-read once (the write's own bus echo included).
   */
  saved: () => void;
}

/**
 * @param objectName the object the form reads
 * @param recordId the record it reads
 * @param readsRecord whether it reads one at all — edit or view mode with a
 *   `recordId`, and (for the default arm) no inline field source. When `false`
 *   the bus is not subscribed to and `refetch` never moves.
 */
export function useRecordInvalidation(
  objectName: string | undefined,
  recordId: string | number | undefined,
  readsRecord: boolean,
): RecordInvalidation {
  const busNonce = useDataInvalidation(
    readsRecord ? objectName || undefined : undefined,
    readsRecord && recordId !== undefined ? String(recordId) : undefined,
  );
  const [refetch, setRefetch] = useState(0);
  const dirtyRef = useRef(false);
  const heldRef = useRef(false);
  const seenNonceRef = useRef(busNonce);
  useEffect(() => {
    if (busNonce === seenNonceRef.current) return;
    seenNonceRef.current = busNonce;
    if (dirtyRef.current) {
      heldRef.current = true;
      return;
    }
    setRefetch((n) => n + 1);
  }, [busNonce]);
  // Created once, as a state value that is never set: both close over the refs
  // above and the state setter, none of which change for the life of the
  // component, so the two functions are the same two for its whole life.
  const [handlers] = useState<Pick<RecordInvalidation, 'onDirtyChange' | 'saved'>>(() => {
    const replayHeld = () => {
      if (!heldRef.current) return;
      heldRef.current = false;
      setRefetch((n) => n + 1);
    };
    return {
      onDirtyChange: (dirty) => {
        dirtyRef.current = dirty;
        if (!dirty) replayHeld();
      },
      saved: () => {
        dirtyRef.current = false;
        replayHeld();
      },
    };
  });
  return { refetch, ...handlers };
}
