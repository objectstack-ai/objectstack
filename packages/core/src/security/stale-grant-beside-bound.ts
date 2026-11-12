// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8] A grant whose package no longer serves its set, beside a grant
 * bound to the holder it reads.
 *
 * A `sys_user_permission_set` row names its set's holder in
 * `permission_set_package`. A column whose package no longer serves the set is
 * stale, and is read as a null one: the resolution rule picks the holder (D8
 * R1, `storedPermissionSetScope`) inside the namespace of the package the
 * column names, and a holder outside it is refused (the catalog's stored-column
 * arm, #31698), so only a holder of that namespace is judged here. Where that reading lands on a package that
 * another stored grant of the same user, set and organization is BOUND to, the
 * stale grant confers nothing. The bound grant is the one that grants that
 * holder's set, and its validity window is the one that applies: a second row
 * never extends it, and never grants it while the bound row's window is closed.
 *
 * The bound grant is looked for among EVERY stored row of the user, its
 * validity window open or not. A grant read by the resolution rule beside no
 * bound grant (alone, or beside grants of other holders or other
 * organizations) reads as it did.
 *
 * Two readers ask it, so the boot report lists exactly the rows the
 * authorization resolver withholds: `resolveUserAuthzGrants` (§6b) and the
 * security plugin's catalog reference report. Only a package holder is judged:
 * the environment's set is bound by no column.
 */

/** The organization a stored grant row belongs to, or `null`; a blank value is the organization-less spelling. */
function organizationOf(row: Record<string, unknown>): string | null {
  const value = row.organization_id ?? row.organizationId;
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/** A non-blank string, trimmed; anything else is `undefined`. */
function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
}

/** The key a grant's siblings share: its set's name and its organization. */
function siblingKey(name: string, organizationId: string | null): string {
  return `${name}\u0000${organizationId ?? ''}`;
}

/**
 * [ADR-0150 D8] The packages the stored grants `rows` (one user's) are bound
 * to, per set name and organization — every row, its validity window open or
 * not.
 */
export function boundGrantPackages(rows: readonly unknown[]): ReadonlyMap<string, ReadonlySet<string>> {
  const bound = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = textOf(r.permission_set);
    const packageId = textOf(r.permission_set_package);
    if (name === undefined || packageId === undefined) continue;
    const key = siblingKey(name, organizationOf(r));
    let packages = bound.get(key);
    if (!packages) bound.set(key, (packages = new Set()));
    packages.add(packageId);
  }
  return bound;
}

/**
 * [ADR-0150 D8] Does the stored grant `row`, whose set the catalog resolved to
 * the holder `resolvedPackageId`, confer nothing because its column is stale
 * (it names another package) and another grant of the same user, set and
 * organization is bound to that holder? `bound` is {@link boundGrantPackages}
 * of the user's stored grants.
 */
export function staleGrantBesideBoundGrant(
  row: unknown,
  resolvedPackageId: string | null,
  bound: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (resolvedPackageId === null || !row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  const name = textOf(r.permission_set);
  const column = textOf(r.permission_set_package);
  if (name === undefined || column === undefined || column === resolvedPackageId) return false;
  return bound.get(siblingKey(name, organizationOf(r)))?.has(resolvedPackageId) ?? false;
}
