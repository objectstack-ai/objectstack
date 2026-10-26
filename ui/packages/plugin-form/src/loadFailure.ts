/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The load error a record form shows, kept PER READ (objectui#10682).
 *
 * Each layout `ObjectForm` routes to (its default arm, `DrawerForm`,
 * `ModalForm`, `SplitForm`, `TabbedForm`, `WizardForm`) reads two things
 * before it can draw: the object schema (`getObjectSchema`) and the record
 * (`findOne`). Each used to keep ONE `error` that both reads wrote and nothing
 * cleared, and each renders its error screen ahead of the form, so one failed
 * read kept the form off screen until a remount.
 *
 * The objectui#10578 rule (clear on a successful commit, never at run start)
 * cannot be applied to one slot that two reads write: a record read that
 * succeeds says nothing about the schema, and it can only run over the schema
 * of an EARLIER object (the one already in state), so clearing there would draw
 * the new record against the wrong fields with no report. So each read keeps
 * its own failure, and the form shows its error screen while either is set:
 *
 *   - a read's failure is cleared when a later run of the SAME read commits;
 *   - only the CURRENT run of a read writes its failure at all, so a run that
 *     a newer one of the same read has superseded may neither clear the
 *     current failure nor raise its own over the current values (the run
 *     sequence PR objectui#10680 gave `ObjectTimeline`).
 *
 * Private to this package: no form's props or schema change.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

/** The two reads a record form makes before it can draw. */
export type LoadSource = 'schema' | 'record';

/** The latest failure of each read, or `null` when its current run has not failed. */
export type LoadFailures = Readonly<Record<LoadSource, Error | null>>;

/** Neither read has failed. */
export const NO_LOAD_FAILURES: LoadFailures = { schema: null, record: null };

/** The number of the latest run of each read. Held in a ref: nothing renders from it. */
export type LoadRunSeq = Record<LoadSource, number>;

/** One run of one read. Each method is a no-op once a newer run of that read has begun. */
export interface LoadRun {
  /** This run failed: its read's failure becomes `err`. */
  fail(err: unknown): void;
  /** This run committed what it read: its read's failure, if any, is cleared. */
  commit(): void;
}

/**
 * Number a new run of `source` and hand back its two writes. Call it once per
 * run of the fetch effect, synchronously in the effect body, so the number
 * moves when the effect does rather than when a read happens to settle.
 */
export function beginLoadRun(
  seqRef: MutableRefObject<LoadRunSeq>,
  setFailures: Dispatch<SetStateAction<LoadFailures>>,
  source: LoadSource,
): LoadRun {
  const seq = ++seqRef.current[source];
  const isCurrent = () => seqRef.current[source] === seq;
  return {
    fail(err) {
      if (isCurrent()) setFailures((failures) => ({ ...failures, [source]: err as Error }));
    },
    commit() {
      if (!isCurrent()) return;
      setFailures((failures) => (failures[source] === null ? failures : { ...failures, [source]: null }));
    },
  };
}

/**
 * The failure the error screen reports, or `null` when the form may draw. The
 * schema's comes first: without it the fields the record fills are unknown.
 */
export function shownLoadFailure(failures: LoadFailures): Error | null {
  return failures.schema || failures.record;
}
