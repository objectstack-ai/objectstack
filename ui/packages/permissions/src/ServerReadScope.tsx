/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useContext, type ReactNode } from 'react';
import { PermCtx, type PermissionContextValue } from './PermissionContext.js';

export interface ServerReadScopeProps {
  /**
   * The objects whose reads, below this scope, are the server's to answer.
   * Matched case-insensitively, as `MePermissionsProvider` matches object
   * names.
   */
  objects: readonly string[];
  children: ReactNode;
}

/** One derived value per enclosing value and object set (see below). */
const SCOPED = new WeakMap<PermissionContextValue, Map<string, PermissionContextValue>>();

/**
 * The enclosing value with the two READ verdicts answering "allowed" for
 * `objects`, cached on the enclosing value itself.
 *
 * The cache is a module-level `WeakMap` keyed on the enclosing context value
 * (the shape `usePermissions` and `discardProofCache.ts` use), never a
 * `useMemo`: consumers name the permission value in dependency arrays, so a
 * discarded memo would re-run their effects with nothing changed (AGENTS.md
 * #10). The inner key is the sorted, lower-cased object list, so a caller that
 * passes a fresh array with the same names each render reads one identity.
 */
function scoped(parent: PermissionContextValue, objects: readonly string[]): PermissionContextValue {
  const names = [...new Set(objects.map((name) => name.toLowerCase()))].sort();
  const key = JSON.stringify(names);
  let byObjects = SCOPED.get(parent);
  if (!byObjects) {
    byObjects = new Map();
    SCOPED.set(parent, byObjects);
  }
  const hit = byObjects.get(key);
  if (hit) return hit;
  const served = (object: string) => names.includes((object ?? '').toLowerCase());
  const value: PermissionContextValue = {
    ...parent,
    check: (object, action, record) =>
      action === 'read' && served(object) ? { allowed: true } : parent.check(object, action, record),
    checkField: (object, field, action) =>
      action === 'read' && served(object) ? true : parent.checkField(object, field, action),
  };
  byObjects.set(key, value);
  return value;
}

/**
 * Leaves the READS of `objects` to the server that serves them
 * (objectui#13324).
 *
 * The client's read gates — `check(object, 'read')` (a related list of an
 * object the caller may not read is not drawn) and `checkField(object, field,
 * 'read')` (and so `withoutDeniedFields` and `useFieldPermissions().canRead`,
 * which fold a served row down to the fields the caller may read) — mirror the
 * DATA API's rule, as `/auth/me/permissions` reports it. A row can reach a page
 * through another door: a service route that admits the caller by its own rule
 * and serves only what that rule allows (objectstack's approvals routes serve a
 * request, and its timeline, to each party to it). The data API's answer does
 * not describe that door. A caller the data API keeps out of an object is
 * absent from the answer for it, both gates fail closed for an absent object,
 * and the page hides or strips everything the door served.
 *
 * Below this scope both read verdicts answer "allowed" for `objects`: whatever
 * the server serves is what the viewer may read, and a read it refuses fails as
 * that read. Everything else is the enclosing provider's, unchanged — every
 * other action (`create`, `update`, `delete`, `export`, …) and the field
 * `write` / `create` verdicts (serving a row grants no write),
 * `getFieldPermissions`, `getObjectApiOperations`, `effectiveObjects` (the data
 * the `current_user.can` predicate reads) and every other object.
 *
 * Mount it only over surfaces whose reads of `objects` all come back
 * server-filtered: through a door that applies its own read rule, or through a
 * data API that refuses the caller or removes the fields they may not read
 * before it answers (ObjectStack's does both). The client gates mirror that
 * filtering; the boundary is the server's.
 *
 * With no enclosing provider there is nothing to narrow — `usePermissions()`
 * already answers every read allowed — so the scope renders its children as
 * they are.
 */
export function ServerReadScope({ objects, children }: ServerReadScopeProps) {
  const parent = useContext(PermCtx);
  if (!parent) return <>{children}</>;
  return <PermCtx.Provider value={scoped(parent, objects)}>{children}</PermCtx.Provider>;
}
