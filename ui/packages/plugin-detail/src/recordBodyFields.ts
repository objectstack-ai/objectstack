/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * The fields the record page's BODY draws, as the body draws them
 * (objectstack#35941).
 *
 * The page's meta line names the record's owner. When a details section on
 * the page already draws `owner_id`, the owner shows there, as a field the
 * reader can change, so the meta line leaves it out and the owner appears
 * once. Which fields the body draws is not something a page host can read
 * off the page tree: a field lands in a declared group, in the derived
 * "other" bucket or in the auto-split sections, and the body then drops
 * what the reader may not read, what a `visibleWhen` hides, a group whose
 * own `visibleWhen` is false, and the rows of a collapsed section. So the
 * answer comes from the body itself: every `DetailSection` that draws the
 * page's record reports the field rows it draws, and the meta line reads
 * the union. A row the reader cannot see is not reported, so the owner never
 * goes missing from both places.
 *
 * "The page's record" is the record `record:details` reads when it carries
 * no data binding (`RecordPageProvenanceContext`). A section drawn for any
 * other record, such as a bound `record:details`, or a drawer opened from a
 * related list (a React portal keeps the page's context), reports nothing.
 *
 * Module-internal on purpose, the way `RecordPageProvenanceContext` is: not
 * in the package barrel, and neither a prop nor a schema key. The laid-out
 * record page (`RecordPageColumns`) mounts the registry around the details
 * column and the meta line it closes with. Outside a registry the meta line
 * reads `null` and keeps its strip-only rule.
 */
export interface RecordBodyFields {
  /** The union of the reported field names; a new set whenever it changes. */
  getNames: () => ReadonlySet<string>;
  subscribe: (listener: () => void) => () => void;
  /** Report the rows one section draws; an empty list withdraws them. */
  report: (sectionId: string, names: readonly string[]) => void;
  withdraw: (sectionId: string) => void;
}

const EMPTY_NAMES: ReadonlySet<string> = new Set<string>();

export function createRecordBodyFields(): RecordBodyFields {
  const bySection = new Map<string, readonly string[]>();
  const listeners = new Set<() => void>();
  let names: ReadonlySet<string> = EMPTY_NAMES;
  const recompute = () => {
    const next = new Set<string>();
    for (const list of bySection.values()) for (const name of list) next.add(name);
    if (next.size === names.size && Array.from(next).every((name) => names.has(name))) return;
    names = next;
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    getNames: () => names,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report(sectionId, list) {
      if (list.length === 0) {
        if (bySection.delete(sectionId)) recompute();
        return;
      }
      bySection.set(sectionId, [...list]);
      recompute();
    },
    withdraw(sectionId) {
      if (bySection.delete(sectionId)) recompute();
    },
  };
}

export const RecordBodyFieldsContext = React.createContext<RecordBodyFields | null>(null);

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Report the field rows a section draws, for as long as it draws them. A
 * layout effect, so the meta line has its answer before the page paints.
 * Nothing is reported outside a registry.
 */
export function useReportBodyFields(names: readonly string[]): void {
  const registry = React.useContext(RecordBodyFieldsContext);
  const sectionId = React.useId();
  const key = names.join('|');
  useIsomorphicLayoutEffect(() => {
    if (!registry) return undefined;
    registry.report(sectionId, key.length === 0 ? [] : key.split('|'));
    return () => registry.withdraw(sectionId);
  }, [registry, sectionId, key]);
}

const NO_SUBSCRIPTION = () => () => {};
const NO_NAMES = (): ReadonlySet<string> | null => null;

/** The fields the page's body draws, or `null` when no registry is mounted. */
export function useBodyDrawnFieldNames(): ReadonlySet<string> | null {
  const registry = React.useContext(RecordBodyFieldsContext);
  return React.useSyncExternalStore<ReadonlySet<string> | null>(
    registry ? registry.subscribe : NO_SUBSCRIPTION,
    registry ? registry.getNames : NO_NAMES,
    registry ? registry.getNames : NO_NAMES,
  );
}
