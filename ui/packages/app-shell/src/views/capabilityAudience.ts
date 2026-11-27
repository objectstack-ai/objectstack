// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who a list view's (or a dashboard's) audience gate reaches — the catalog the
 * "Who sees this view" pickers offer and the positions they preview
 * (objectstack#34908, ruling 7103739693 letter B).
 *
 * The gate is the existing `requiredPermissions` (ruling 6095014058): a list of
 * capabilities, every one required, enforced by the server's `/meta` read gate.
 * A capability reaches a person through a permission set's `systemPermissions`,
 * and a position passes on the capabilities of the permission sets it grants
 * (ADR-0131 D3/D4) — it carries none of its own. So this
 * module reads three registries and joins them; it writes nothing, and the
 * view surface never grants (granting stays in Setup).
 *
 * The catalog is CLOSED: the names offered are the capabilities the registry
 * declares (`defineCapability`) and every name a permission set grants — the
 * same "known capability" set `validateCapabilityReferences` in
 * `@objectstack/lint` resolves against — so an administrator, or an AI driving
 * the console, cannot pick a name that matches nothing (a misspelled gate hides
 * the view, or the dashboard, from everyone, its author included).
 *
 * The position preview reads which sets each position grants from the server:
 * `GET /meta/position?include=grants` serves `_grantedPermissionSets`, the sets
 * in force as the authorization resolver reads them (`describePositionGrants`),
 * so the browser never joins a position's raw `permissionSets` itself. A
 * position is listed when those sets grant EVERY picked capability between
 * them. A list served without that decoration (no security service, a caller
 * it is not described for) leaves the positions unknown, never guessed. The
 * preview still cannot list people who hold a set directly rather than through
 * a position; the server's gate stays the authority.
 */

/** One capability the environment knows, as the pickers offer it. */
export interface CapabilityOption {
  /** The capability name — what `requiredPermissions` stores. */
  name: string;
  /** The declaration's label, when the registry declares one. */
  label?: string;
  /** The permission sets granting it, by name, sorted. */
  grantedBy: string[];
}

/** One position, with the capabilities its permission sets grant. */
export interface PositionReach {
  name: string;
  label?: string;
  /** Every capability granted by the sets the position grants in force, as served. */
  capabilities: string[];
}

/** The joined catalog: what may be picked, and which positions hold what. */
export interface CapabilityAudience {
  capabilities: CapabilityOption[];
  /** `null` when the positions' grants could not be read, or were not served: the preview then says so. */
  positions: PositionReach[] | null;
}

type Row = Record<string, unknown>;

/** A list row as the metadata list read answers it: the item, or an envelope around it. */
function unwrap(raw: unknown): Row | null {
  const item = raw && typeof raw === 'object' && 'item' in (raw as Row) ? (raw as Row).item : raw;
  return item && typeof item === 'object' ? (item as Row) : null;
}

const nameOf = (row: Row): string | undefined =>
  typeof row.name === 'string' && row.name.trim() ? row.name : undefined;
const labelOf = (row: Row): string | undefined =>
  typeof row.label === 'string' && row.label.trim() ? row.label : undefined;
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

/**
 * The sets a position grants in force, as `?include=grants` serves them
 * (`_grantedPermissionSets: [{ name, via }]`); `undefined` when the row carries
 * no such decoration.
 */
function grantedSetsOf(row: Row): string[] | undefined {
  const served = row._grantedPermissionSets;
  if (!Array.isArray(served)) return undefined;
  return served
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Row).name : undefined))
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '');
}

/**
 * Join the three registries' rows into the pickers' catalog. Pure: the rows
 * are what `list('capability')`, `list('permission')` and
 * `list('position', { include: 'grants' })` answered (`positions: null` when
 * that read failed). A position row without the served grants makes the
 * positions unknown (`null`): the preview is never computed from the raw
 * `permissionSets` a position names.
 */
export function buildCapabilityAudience(
  capabilityRows: readonly unknown[],
  permissionSetRows: readonly unknown[],
  positionRows: readonly unknown[] | null,
): CapabilityAudience {
  const labels = new Map<string, string | undefined>();
  for (const raw of capabilityRows) {
    const row = unwrap(raw);
    const name = row && nameOf(row);
    if (row && name) labels.set(name, labelOf(row));
  }
  const grantedBy = new Map<string, Set<string>>();
  const setGrants = new Map<string, string[]>();
  for (const raw of permissionSetRows) {
    const row = unwrap(raw);
    const set = row && nameOf(row);
    if (!row || !set) continue;
    const caps = stringsOf(row.systemPermissions);
    setGrants.set(set, caps);
    for (const cap of caps) {
      if (!grantedBy.has(cap)) grantedBy.set(cap, new Set());
      grantedBy.get(cap)!.add(set);
    }
  }
  const names = new Set<string>([...labels.keys(), ...grantedBy.keys()]);
  const capabilities = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      ...(labels.get(name) ? { label: labels.get(name) } : {}),
      grantedBy: [...(grantedBy.get(name) ?? [])].sort((a, b) => a.localeCompare(b)),
    }));

  const rows = positionRows === null
    ? null
    : positionRows.map(unwrap).filter((row): row is Row => !!row && !!nameOf(row));
  const positions = rows === null || rows.some((row) => grantedSetsOf(row) === undefined)
    ? null
    : rows
        .map((row) => {
          const caps = new Set<string>();
          for (const set of grantedSetsOf(row)!) for (const cap of setGrants.get(set) ?? []) caps.add(cap);
          return {
            name: nameOf(row)!,
            ...(labelOf(row) ? { label: labelOf(row) } : {}),
            capabilities: [...caps].sort((a, b) => a.localeCompare(b)),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

  return { capabilities, positions };
}

/**
 * The positions whose permission sets grant EVERY picked capability — who the
 * gate lets in through a position. Empty `picked` is no gate: `null`, which a
 * preview reads as "everyone who can see the list".
 */
export function positionsReached(
  picked: readonly string[],
  positions: readonly PositionReach[],
): PositionReach[] | null {
  if (picked.length === 0) return null;
  return positions.filter((p) => picked.every((cap) => p.capabilities.includes(cap)));
}

/** The metadata reads {@link loadCapabilityAudience} makes — the console `MetadataClient`'s `list`. */
export interface CapabilityAudienceSource {
  list: (type: string, options?: { include?: 'grants' }) => Promise<unknown[]>;
}

/**
 * Read the three registries and join them. A failed capability or permission
 * set read fails the load (the pickers then say so and keep a text box); a
 * failed position read keeps the catalog and leaves `positions` `null`.
 */
export async function loadCapabilityAudience(source: CapabilityAudienceSource): Promise<CapabilityAudience> {
  const [capabilities, permissionSets, positions] = await Promise.all([
    source.list('capability'),
    source.list('permission'),
    source.list('position', { include: 'grants' }).catch(() => null),
  ]);
  return buildCapabilityAudience(
    Array.isArray(capabilities) ? capabilities : [],
    Array.isArray(permissionSets) ? permissionSets : [],
    positions === null ? null : Array.isArray(positions) ? positions : [],
  );
}
