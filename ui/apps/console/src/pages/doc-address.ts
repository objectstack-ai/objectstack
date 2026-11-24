/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The route's package segment (`/apps/X/docs/...`) is ADR-0048 prefer-local
 * context for a doc read, never an exact address. The server's `?package=X`
 * read answers only X's own item (ADR-0150 D3/D5): where X ships none of the
 * name, a `409 RESOURCE_CONFLICT` whose `details.candidates` name the packages
 * that do, X not among them (ruling 6917064203 on objectstack#34398), or `404`
 * when no package does. Both doc doors that read under the segment, the
 * reader (`DocPage`) and the flat permalink (`DocsSlug`), read such a name by
 * name instead, so a cross-reference to another package's doc and the
 * app-name segment of a package that ships several apps (no package id at
 * all) reach the doc's holder, as the portal reads it.
 */

/**
 * The packages a `409 RESOURCE_CONFLICT` read names as holders of the name:
 * `@objectstack/client` carries the refusal's `details.candidates` on the
 * rejection (`{ kind: 'package', packageId }` per package). Null for any other
 * failure, and for a refusal that names no package.
 */
export function conflictCandidates(err: unknown): string[] | null {
  const e = err as { httpStatus?: unknown; code?: unknown; details?: { candidates?: unknown } } | null;
  if (e?.httpStatus !== 409 || e.code !== 'RESOURCE_CONFLICT') return null;
  const candidates = e.details?.candidates;
  if (!Array.isArray(candidates)) return null;
  const packageIds = candidates
    .filter((c): c is { kind: 'package'; packageId: string } =>
      c?.kind === 'package' && typeof c.packageId === 'string' && c.packageId !== '')
    .map((c) => c.packageId);
  return packageIds.length > 0 ? packageIds : null;
}

/**
 * Whether a read at the route's package `packageId` that rejected with `err`
 * is re-read by name: a `404`, or a `409` whose candidates leave `packageId`
 * out. Any other failure (a refusal of the reader, a 409 naming the route's own
 * package, a server error) is the answer at that address and stands.
 */
export function readsByNameAfter(err: unknown, packageId: string): boolean {
  if ((err as { httpStatus?: unknown } | null)?.httpStatus === 404) return true;
  const holders = conflictCandidates(err);
  return holders !== null && !holders.includes(packageId);
}
