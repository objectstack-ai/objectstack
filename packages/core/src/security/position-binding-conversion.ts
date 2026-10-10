// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4/D10] The `sys_position_permission_set` junction rows, turned
 * into the `permissionSets` each position definition carries.
 *
 * The authorization resolver reads a position's sets from its definition
 * (`PositionSchema.permissionSets`) and no longer reads the junction. The rows
 * a deployment already holds are converted by the upgrade ceremony
 * (`os migrate`, C7b), which calls this function and applies its answer through
 * the metadata door. ⛔ Never at boot: a conversion that ran on every start
 * would be the dual source ADR-0131 D10 retires.
 *
 * The function is pure. It takes the three tables as read, and the definitions
 * the catalog already holds, and answers per position name:
 *
 *  - `declared` — the definition already names every set the rows bind:
 *    nothing to write.
 *  - `converted` — the rows bind sets the definition does not name:
 *    `permissionSets` is the definition's list followed by the rows' sets, in
 *    row order. A binding only ever adds, so the declared sets stay.
 *  - `conflicting` — organizations that hold a row of this name bind different
 *    sets to it (an organization's row with no binding binds the empty list).
 *    Merging them would grant one organization's members another's sets, so the
 *    name is reported and never guessed (D10 fate 4).
 *
 * A binding whose position or set row is missing, or names nothing, is listed
 * in `dangling` and converted nowhere.
 *
 * Its sibling {@link convertDeactivatedCatalogRows} carries the rows' ADR-0049
 * `active` flags into the activation ledger, which is where the resolver reads
 * deactivation from.
 */

/** One `sys_position` or `sys_permission_set` row, as the conversion reads it. */
export interface CatalogRowForConversion {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly organization_id?: unknown;
}

/** One `sys_position_permission_set` row. */
export interface PositionBindingRow {
  readonly id?: unknown;
  readonly position_id?: unknown;
  readonly permission_set_id?: unknown;
}

/** The rows and definitions a conversion reads. */
export interface PositionBindingConversionInput {
  readonly positions: readonly CatalogRowForConversion[];
  readonly permissionSets: readonly CatalogRowForConversion[];
  readonly bindings: readonly PositionBindingRow[];
  /** The `permissionSets` each position definition in the catalog names today, by position name. */
  readonly declared?: ReadonlyMap<string, readonly string[]>;
}

/** The answer for one position name. */
export type PositionBindingFate =
  | { readonly name: string; readonly fate: 'declared'; readonly permissionSets: readonly string[] }
  | { readonly name: string; readonly fate: 'converted'; readonly permissionSets: readonly string[] }
  | {
      readonly name: string;
      readonly fate: 'conflicting';
      /** The sets each organization's row binds, keyed by organization id (`''` for an organization-less row). */
      readonly byOrganization: Readonly<Record<string, readonly string[]>>;
    };

/** A binding the conversion could not place. */
export interface DanglingPositionBinding {
  readonly id: string | undefined;
  readonly reason: 'position-missing' | 'permission-set-missing';
}

export interface PositionBindingConversion {
  /** One entry per position name a binding reaches, in first-binding order. */
  readonly positions: readonly PositionBindingFate[];
  readonly dangling: readonly DanglingPositionBinding[];
}

const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value !== '') || typeof value === 'number' ? String(value) : undefined;

const organizationKey = (value: unknown): string => text(value) ?? '';

/**
 * Convert the junction rows into position definitions' `permissionSets`
 * (module doc). Deterministic: the same rows answer the same result.
 */
export function convertPositionBindingRows(input: PositionBindingConversionInput): PositionBindingConversion {
  const positionById = new Map<string, { name: string; organization: string }>();
  for (const row of input.positions) {
    const id = text(row.id);
    const name = text(row.name);
    if (id && name) positionById.set(id, { name, organization: organizationKey(row.organization_id) });
  }
  const setNameById = new Map<string, string>();
  for (const row of input.permissionSets) {
    const id = text(row.id);
    const name = text(row.name);
    if (id && name) setNameById.set(id, name);
  }

  // Position name → organization → the set names its row binds, in row order.
  const bound = new Map<string, Map<string, string[]>>();
  const dangling: DanglingPositionBinding[] = [];
  for (const binding of input.bindings) {
    const position = positionById.get(text(binding.position_id) ?? '');
    if (!position) {
      dangling.push({ id: text(binding.id), reason: 'position-missing' });
      continue;
    }
    const setName = setNameById.get(text(binding.permission_set_id) ?? '');
    if (!setName) {
      dangling.push({ id: text(binding.id), reason: 'permission-set-missing' });
      continue;
    }
    let byOrganization = bound.get(position.name);
    if (!byOrganization) bound.set(position.name, (byOrganization = new Map()));
    const sets = byOrganization.get(position.organization) ?? [];
    if (!sets.includes(setName)) sets.push(setName);
    byOrganization.set(position.organization, sets);
  }

  // Every organization holding a row of a bound name takes part, with what it binds.
  for (const { name, organization } of positionById.values()) {
    const byOrganization = bound.get(name);
    if (byOrganization && !byOrganization.has(organization)) byOrganization.set(organization, []);
  }

  const positions: PositionBindingFate[] = [];
  for (const [name, byOrganization] of bound) {
    const lists = [...byOrganization.values()];
    const signature = (sets: readonly string[]) => [...sets].sort().join('\u0000');
    if (new Set(lists.map(signature)).size > 1) {
      positions.push({ name, fate: 'conflicting', byOrganization: Object.fromEntries(byOrganization) });
      continue;
    }
    const declared = input.declared?.get(name) ?? [];
    const added = lists[0].filter((set) => !declared.includes(set));
    positions.push(
      added.length === 0
        ? { name, fate: 'declared', permissionSets: [...declared] }
        : { name, fate: 'converted', permissionSets: [...declared, ...added] },
    );
  }
  return { positions, dangling };
}

/** One `sys_position` / `sys_permission_set` row as the deactivation conversion reads it. */
export interface ActivatableCatalogRow extends CatalogRowForConversion {
  readonly active?: unknown;
}

/**
 * An activation-ledger row (`sys_metadata_activation`, ADR-0126 §4) the
 * conversion answers. The applier supplies `package_id`, which the ledger
 * object requires and the catalog rows do not carry.
 */
export interface CatalogLedgerRow {
  readonly metadata_type: 'position' | 'permission';
  readonly name: string;
  readonly active: false;
}

export interface CatalogDeactivationConversion {
  /** The names to switch off in the ledger, one row each. */
  readonly ledger: readonly CatalogLedgerRow[];
  /** Names some organizations' rows switch off and others' keep on — reported, never guessed (D10 fate 4). */
  readonly conflicting: ReadonlyArray<{ metadata_type: 'position' | 'permission'; name: string; byOrganization: Readonly<Record<string, boolean>> }>;
}

const rowIsOff = (value: unknown): boolean =>
  value === false || value === 0 || value === '0' || value === 'false';

/**
 * [ADR-0131 D3, ADR-0126 §4] The catalog rows' ADR-0049 `active` flags,
 * turned into activation-ledger rows. The resolver reads deactivation from the
 * ledger, never from the row; the upgrade ceremony applies this with
 * {@link convertPositionBindingRows}. ⛔ Never at boot.
 *
 * A name whose every row is off gets one ledger row. A name some
 * organizations switched off and others did not is `conflicting`: the ledger
 * is deployment-wide, so switching it off would revoke it from organizations
 * that kept it.
 */
export function convertDeactivatedCatalogRows(input: {
  readonly positions: readonly ActivatableCatalogRow[];
  readonly permissionSets: readonly ActivatableCatalogRow[];
}): CatalogDeactivationConversion {
  const ledger: CatalogLedgerRow[] = [];
  const conflicting: Array<{ metadata_type: 'position' | 'permission'; name: string; byOrganization: Record<string, boolean> }> = [];
  for (const [metadataType, rows] of [['position', input.positions], ['permission', input.permissionSets]] as const) {
    const byName = new Map<string, Record<string, boolean>>();
    for (const row of rows) {
      const name = text(row.name);
      if (!name) continue;
      const states = byName.get(name) ?? {};
      states[organizationKey(row.organization_id)] = !rowIsOff(row.active);
      byName.set(name, states);
    }
    for (const [name, states] of byName) {
      const values = Object.values(states);
      if (values.every((on) => on)) continue;
      if (values.every((on) => !on)) ledger.push({ metadata_type: metadataType, name, active: false });
      else conflicting.push({ metadata_type: metadataType, name, byOrganization: states });
    }
  }
  return { ledger, conflicting };
}
