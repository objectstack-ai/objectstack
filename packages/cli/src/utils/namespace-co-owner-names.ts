// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2, child N] `os validate`'s and `os build`'s half of the package
 * door's namespace name refusal: inside one namespace, an item of the twelve
 * uncovered bucket 2/3 types (sharing rule, queue, assignment rule, hook, job,
 * app, page, dashboard, report, book, analytics cube, tool) has one package
 * holder.
 *
 * ## One judge, not a second rule
 *
 * The predicate and its sentence are `@objectstack/objectql`'s
 * (`namespaceNameConflicts`, `namespaceNameConflictMessage`) — the SAME pair
 * `SchemaRegistry.installPackage` throws the answer of. ⛔ Not an
 * `@objectstack/lint` rule and not a re-spelling of the check: what this module
 * owns is the WALK — which packages the boot installs, in which order.
 *
 * ## The walk is the boot path's
 *
 * The boot installs an artifact's `packages[]` bodies one after another, in
 * `resolveArtifactPackageOrder`'s dependency order (`@objectstack/core`, the
 * one reader of `packages[]`), and asks the predicate about each against the
 * packages installed before it. This walk does the same: each body, in that
 * order, against the bodies before it. A stack with no `packages[]` is one
 * package, which never holds a name beside itself, so it is never refused
 * here.
 *
 * Unlike the boot, which stops at the first refusal, every refused body is
 * reported, and a refused body still counts as a holder for the bodies after
 * it: the artifact declares it, and the author has to hear about every holder
 * (red line 2: ambiguity is reported, never guessed).
 *
 * ⚠️ Bounds, stated rather than hidden: the packages a deployment already has
 * installed are not visible here (that half is the package door's alone), and
 * the residual — top-level items no body declares, registered under the
 * stack's own id without an install — is not judged at either door.
 */

import { resolveArtifactPackageOrder } from '@objectstack/core';
import {
  NAMESPACE_CONFLICT_CODE,
  namespaceNameConflictMessage,
  namespaceNameConflicts,
  namespacePackageOf,
  type NamespaceNameConflict,
  type NamespacePackage,
} from '@objectstack/objectql';

/** One refused package, located. `message` is the package door's, verbatim. */
export interface NamespaceNameRefusalRow {
  /** The refused package's id, as the registry installs it. */
  packageId: string;
  /** The ADR-0112 code the package door throws with. */
  code: string;
  /** The HTTP status the package door throws with. */
  httpStatus: number;
  /** The refusal, in the package door's own words. */
  message: string;
  /** Every `(type, name)` refused, each naming every holder. */
  conflicts: NamespaceNameConflict[];
}

/**
 * Every package of this stack's artifact that the package door would refuse
 * for a name another package of its namespace holds, in the order the boot
 * installs them. `[]` for a stack the door accepts on this axis.
 */
export function findNamespaceNameRefusals(parsed: Record<string, unknown>): NamespaceNameRefusalRow[] {
  if (parsed.packages === undefined) return [];
  const installed: NamespacePackage[] = [];
  const rows: NamespaceNameRefusalRow[] = [];
  for (const body of resolveArtifactPackageOrder(parsed)) {
    const incoming = namespacePackageOf(body);
    if (incoming === undefined) continue;
    const conflicts = namespaceNameConflicts(incoming, installed);
    if (conflicts.length > 0) {
      rows.push({
        packageId: incoming.packageId,
        code: NAMESPACE_CONFLICT_CODE,
        httpStatus: 422,
        message: namespaceNameConflictMessage(conflicts),
        conflicts,
      });
    }
    installed.push(incoming);
  }
  return rows;
}
