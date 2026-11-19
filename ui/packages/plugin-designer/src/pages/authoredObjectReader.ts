/**
 * The app pages' reads of what an author stored, at the package it is stored in.
 * @module
 */

import { useCallback, useMemo } from 'react';

/**
 * The value the server stamps as `_packageId` on a row bound to NO package. It
 * names no package, so it is never sent as one.
 */
const PACKAGELESS_SENTINEL = 'sys_metadata';

/**
 * The package that owns a served item, or `undefined` for an item no package
 * owns: the one address an authored read of it, and a save of it, names
 * (objectstack#35115). The same reading as App management's `owningPackage`
 * (objectui#12300), so one served value means one scope across the console.
 */
export function owningPackage(item: { _packageId?: unknown } | undefined): string | undefined {
  const packageId = item?._packageId;
  return typeof packageId === 'string' && packageId !== '' && packageId !== PACKAGELESS_SENTINEL
    ? packageId
    : undefined;
}

/** The adapter method this reads through (`ObjectStackAdapter.getAuthoredItem`). */
type AuthoredItemReader = (
  type: string,
  name: string,
  options?: { packageId?: string },
) => Promise<Record<string, unknown> | null>;

/**
 * The wizard's `readAuthoredObject` (objectstack#35101): an object's definition
 * as its author stored it, read from the untranslated layers at the package
 * the served object came from. `undefined` when the adapter has no authored
 * read, so the wizard writes no plural label rather than a served one.
 */
export function useAuthoredObjectReader(
  adapter: { getAuthoredItem?: AuthoredItemReader } | null | undefined,
  servedObjects: ReadonlyArray<{ name?: unknown; _packageId?: unknown }> | undefined,
): ((objectName: string) => Promise<Record<string, unknown> | null>) | undefined {
  const packageByObject = useMemo(() => {
    const map = new Map<string, string>();
    for (const obj of servedObjects ?? []) {
      const packageId = owningPackage(obj);
      if (typeof obj.name === 'string' && packageId) map.set(obj.name, packageId);
    }
    return map;
  }, [servedObjects]);
  const read = useCallback(
    (objectName: string) => {
      const packageId = packageByObject.get(objectName);
      return adapter!.getAuthoredItem!('object', objectName, packageId ? { packageId } : {});
    },
    [adapter, packageByObject],
  );
  return adapter?.getAuthoredItem ? read : undefined;
}
