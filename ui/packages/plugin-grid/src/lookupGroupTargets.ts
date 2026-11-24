/**
 * The object a grouping lookup points at, read so its group headers are named
 * by that object's declared `nameField` (through `@object-ui/core`'s
 * `referencedRecordTitle`) rather than by a guessed `name` / `label` / `title`
 * key. Shared by the server-grouped headers (`useServerGrouping.ts`) and the
 * client grouping formatter (`objectGridGrouping.ts`).
 */

import { useEffect, useState } from 'react';
import type { DataSource } from '@object-ui/types';

/**
 * The definition of `objectName`, or `undefined` when the data source cannot
 * serve one or the read fails. Never rejects: a group header with no target
 * definition is still labelled, by the record alone.
 *
 * One read per call; the ObjectStack adapter serves repeat reads of an object
 * from its metadata cache, so each target is fetched at most once per session.
 */
export async function readLookupTargetDef(
  dataSource: Pick<DataSource, 'getObjectSchema'> | null | undefined,
  objectName: string,
): Promise<unknown> {
  if (!dataSource || typeof dataSource.getObjectSchema !== 'function') return undefined;
  try {
    const def = await dataSource.getObjectSchema(objectName);
    return def && typeof def === 'object' ? def : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The definitions of `targets` (object names), keyed by name, read once per
 * target per change of the list. A target still in flight, or one that could
 * not be read, is absent from the map.
 *
 * Keyed on the list's CONTENT, never on the identity of the array a host may
 * rebuild every render (`ui/AGENTS.md` #10).
 */
export function useLookupTargetDefs(
  dataSource: Pick<DataSource, 'getObjectSchema'> | null | undefined,
  targets: readonly string[],
): ReadonlyMap<string, unknown> | undefined {
  const targetsKey = JSON.stringify([...new Set(targets)].sort());
  const [held, setHeld] = useState<{ key: string; defs: ReadonlyMap<string, unknown> } | null>(null);

  useEffect(() => {
    const names = JSON.parse(targetsKey) as string[];
    if (names.length === 0 || !dataSource) return;
    let cancelled = false;
    void Promise.all(names.map(async (name) => [name, await readLookupTargetDef(dataSource, name)] as const))
      .then((answers) => {
        if (cancelled) return;
        const defs = new Map<string, unknown>();
        for (const [name, def] of answers) if (def !== undefined) defs.set(name, def);
        setHeld({ key: targetsKey, defs });
      });
    return () => { cancelled = true; };
  }, [dataSource, targetsKey]);

  return held?.key === targetsKey ? held.defs : undefined;
}
