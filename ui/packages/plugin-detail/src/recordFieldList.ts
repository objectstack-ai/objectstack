/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * The record page's field area as ONE list (objectstack#36147): the side
 * preview, the phone's 「详情」 tab and the wide page's pinned left column all
 * draw the record's fields through `DetailSection`'s frameless face, and the
 * laid-out page (`RecordPageColumns`) mounts this context around them.
 *
 * Under it the field area folds every empty field of every group into ONE
 * row at the end of the list (「显示 N 个空字段」) instead of a toggle per
 * group: each section hides its empty rows and reports how many it hid, the
 * list's last row reads the total and reveals them all. The reader's choice
 * is the one per-object record-page preference `showEmptyFields`
 * (objectstack#25883), so it holds for the next record of the object.
 *
 * Module-internal on purpose, the way `RecordBodyFieldsContext` is: not in
 * the package barrel, and neither a prop nor a schema key. Outside it a
 * section keeps its own per-group toggle.
 */
export interface RecordFieldList {
  /** Whether the reader asked to see the empty fields. */
  showEmpty: boolean;
  /** Flip `showEmpty`. */
  toggleShowEmpty: () => void;
  /** The tally of empty rows the list's sections hold. */
  emptyFields: EmptyFieldTally;
}

/** How many empty rows the sections of one list hold, summed. */
export interface EmptyFieldTally {
  getTotal: () => number;
  subscribe: (listener: () => void) => () => void;
  /** Report one section's empty rows; `0` withdraws it. */
  report: (sectionId: string, count: number) => void;
  withdraw: (sectionId: string) => void;
}

export function createEmptyFieldTally(): EmptyFieldTally {
  const bySection = new Map<string, number>();
  const listeners = new Set<() => void>();
  let total = 0;
  const recompute = () => {
    let next = 0;
    for (const count of bySection.values()) next += count;
    if (next === total) return;
    total = next;
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    getTotal: () => total,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report(sectionId, count) {
      if (count <= 0) {
        if (bySection.delete(sectionId)) recompute();
        return;
      }
      bySection.set(sectionId, count);
      recompute();
    },
    withdraw(sectionId) {
      if (bySection.delete(sectionId)) recompute();
    },
  };
}

export const RecordFieldListContext = React.createContext<RecordFieldList | null>(null);

/** The field list a section is drawn in, or `null` outside the laid-out record page. */
export function useRecordFieldList(): RecordFieldList | null {
  return React.useContext(RecordFieldListContext);
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Report the empty rows a section holds, for as long as it holds them. A
 * layout effect, so the list's last row has its count before the page paints.
 * Nothing is reported outside a field list.
 */
export function useReportEmptyFields(count: number): void {
  const list = React.useContext(RecordFieldListContext);
  const sectionId = React.useId();
  useIsomorphicLayoutEffect(() => {
    if (!list) return undefined;
    list.emptyFields.report(sectionId, count);
    return () => list.emptyFields.withdraw(sectionId);
  }, [list, sectionId, count]);
}

const NO_SUBSCRIPTION = () => () => {};
const NO_TOTAL = () => 0;

/** How many empty rows the list's sections hold; `0` outside a field list. */
export function useEmptyFieldTotal(): number {
  const list = React.useContext(RecordFieldListContext);
  const tally = list?.emptyFields;
  return React.useSyncExternalStore(
    tally ? tally.subscribe : NO_SUBSCRIPTION,
    tally ? tally.getTotal : NO_TOTAL,
    tally ? tally.getTotal : NO_TOTAL,
  );
}
