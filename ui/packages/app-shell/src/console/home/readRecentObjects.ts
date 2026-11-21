/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { useMetadata } from '../../providers/MetadataProvider.js';
import { objectPresence } from '../../hooks/useObjectPresence.js';
import { readObjectPresence } from '../appObjectScope.js';

/**
 * What Home may do with the object a "Recently accessed" row names
 * (objectstack#34692): `read` it (its label, its icon), leave it `unread`
 * while nobody has said whether this environment registers it, or drop the
 * row, because the environment does not (`absent`).
 */
export type RecentObjectReading = 'read' | 'unread' | 'absent';

/**
 * objectstack#34692 — the rule objectstack#26988 applies to a record page's
 * lists, `DashboardView` to its widgets and the navigation to its
 * `requiresObject` entries, applied to Home's recent rows: a row whose object
 * the registered object list does not hold (its package disabled after the
 * row was stored) is neither drawn nor asked about by name.
 *
 * While nothing has loaded the whole registry, `names` are asked in the ONE
 * `GET /meta/object?names=` presence read (`readObjectPresence`), which leaves
 * an unregistered name out instead of answering it 404. A name it answered
 * served is read by name, as before (objectstack#29121); a name it left out is
 * `absent`; a name not answered yet, or whose read failed, is `unread`: its
 * row is drawn, as every #26988 surface draws an entry its list has not
 * answered, and nothing is asked by name for it (`servedByName`'s rule).
 *
 * Once the whole registry is loaded, or on its way, or on a context with no
 * scope reads, `objectPresence` answers from that list: `absent` only from a
 * list that answered and holds other objects; an empty or unanswered list
 * reads every name as `read`, where no by-name request is made anyway.
 */
export function readRecentObjects(
  metadata: Pick<ReturnType<typeof useMetadata>, 'objects' | 'readObjectScope' | 'getTypeStatus'>,
  names: readonly string[],
): (name: string) => RecentObjectReading {
  const { readObjectScope, getTypeStatus } = metadata;
  if (readObjectScope && getTypeStatus?.('object') === 'idle') {
    if (names.length === 0) return () => 'read';
    const { presence } = readObjectPresence(readObjectScope, undefined, names);
    const served = new Set(presence.objects.map((o) => (o as { name?: unknown } | null | undefined)?.name));
    const missing = new Set(presence.missing);
    return (name) => (served.has(name) ? 'read' : missing.has(name) ? 'absent' : 'unread');
  }
  const status = getTypeStatus?.('object');
  const objects = metadata.objects ?? [];
  return (name) => (objectPresence(name, status, objects) === 'absent' ? 'absent' : 'read');
}
