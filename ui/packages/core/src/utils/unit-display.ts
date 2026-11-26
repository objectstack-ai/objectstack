/**
 * ObjectUI — quantity unit display resolution
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which unit a quantity is in, and what that unit displays as: its label and
 * its display decimal places (ADR-0158 U4, U6, L1, L4, Open item 10).
 *
 * Pure, with no React and no I/O, so every face that draws a quantity — a
 * grid cell, a read-only form field, a detail row — resolves it through the
 * same functions and cannot drift. The rows it resolves against are read by
 * the caller (`@object-ui/fields`' `useQuantityUnit`), which owns the data
 * source and the refusal classification.
 *
 * The order of lookup for a code:
 * - a standard code (`STANDARD_UNITS`, U1) takes the platform's label for it
 *   and the decimal places of its `sys_standard_unit_setting` row (Open item
 *   10, ruled A), when the organization has set one;
 * - an organization code takes the label and `decimal_places` of its
 *   `sys_unit` row (U3, L2);
 * - anything else — a retired or deleted organization unit (L1), a unit row
 *   the reader may not read, or a code no row names — is the bare code, with
 *   no label and no decimal places of its own.
 */

import { STANDARD_UNITS, standardUnitOf } from '@objectstack/spec/data';
import { columnIdentity } from './column-identity.js';

/** The part of a field definition the resolution reads. */
export interface UnitBearingField {
  type?: string;
  unitConfig?: unknown;
}

/** One `sys_unit` row, as far as the display reads it. */
export interface OrganizationUnitRow {
  code?: unknown;
  label?: unknown;
  decimal_places?: unknown;
  retired?: unknown;
  /** The unit's dimension (`mass`, …, `package`), read by the picker's `unitDimension` filter. */
  dimension?: unknown;
  organization_id?: unknown;
}

/** One `sys_standard_unit_setting` row, as far as the display reads it. */
export interface StandardUnitSettingRow {
  code?: unknown;
  decimal_places?: unknown;
  organization_id?: unknown;
}

/**
 * The rows a reader could see. `undefined` for a table means it was not read
 * (still in flight, refused, or no data source): its codes then resolve as if
 * no row named them.
 */
export interface UnitCatalog {
  organizationUnits?: readonly OrganizationUnitRow[];
  standardUnitSettings?: readonly StandardUnitSettingRow[];
}

/** What a quantity's unit displays as. */
export interface ResolvedUnit {
  /** The stored code, exactly as stored. */
  code: string;
  /** The label to show beside the number; absent ⇒ the bare code is shown. */
  label?: string;
  /** The unit's display decimal places (U6); absent ⇒ the field's own width. */
  decimals?: number;
  /** Whether the code is one of the standard table's (U1). */
  standard: boolean;
}

const isBlank = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * The unit code a value of `field` is in, read off `record` where the field
 * points at a sibling, or `undefined` when there is none to show.
 *
 * - `number` with `unitConfig: { unitMode: 'fixed', unit }` → `unit`;
 * - `number` with `unitConfig: { unitMode: 'record', unitField }` → the
 *   record's `unitField` value, or `undefined` when the record holds none (a
 *   caller with no record, such as a footer over many rows, gets none);
 * - `text` with `unitConfig: { unitMode: 'code' }` → the field's own `value`.
 *
 * The code is returned exactly as stored (U4: exact uppercase); it is never
 * trimmed or case-folded into a code the record does not hold.
 */
export function quantityUnitCode(
  field: UnitBearingField | null | undefined,
  record?: Readonly<Record<string, unknown>> | null,
  value?: unknown,
): string | undefined {
  const config = field?.unitConfig;
  if (config === null || typeof config !== 'object') return undefined;
  const { unitMode, unit, unitField } = config as { unitMode?: unknown; unit?: unknown; unitField?: unknown };
  let code: unknown;
  if (field?.type === 'number' && unitMode === 'fixed') code = unit;
  else if (field?.type === 'number' && unitMode === 'record' && typeof unitField === 'string' && unitField !== '') {
    code = record?.[unitField];
  } else if (field?.type === 'text' && unitMode === 'code') code = value;
  return typeof code === 'string' && !isBlank(code) ? code : undefined;
}

/**
 * The sibling field a quantity's code is read from, for a host that builds a
 * projection (`$select`) and must fetch it with the row: `unitField` under
 * `record` mode, `undefined` otherwise.
 */
export function quantityUnitReadField(field: UnitBearingField | null | undefined): string | undefined {
  const config = field?.unitConfig;
  if (field?.type !== 'number' || config === null || typeof config !== 'object') return undefined;
  const { unitMode, unitField } = config as { unitMode?: unknown; unitField?: unknown };
  return unitMode === 'record' && typeof unitField === 'string' && unitField !== '' ? unitField : undefined;
}

/** Whether `field` declares a unit the display draws (a quantity, or a unit-code field). */
export function declaresQuantityUnit(field: UnitBearingField | null | undefined): boolean {
  const config = field?.unitConfig;
  if (config === null || typeof config !== 'object') return false;
  const mode = (config as { unitMode?: unknown }).unitMode;
  return field?.type === 'number' ? mode === 'fixed' || mode === 'record' : field?.type === 'text' && mode === 'code';
}

/**
 * The organization a row belongs to, normalised so that "no stamp" is one
 * value: under the `single` tenancy posture rows carry no organization, and a
 * record and a setting that both carry none belong together.
 */
const organizationOf = (row: { organization_id?: unknown } | null | undefined): string | null =>
  typeof row?.organization_id === 'string' && row.organization_id !== '' ? row.organization_id : null;

/**
 * The row of `code` that belongs to the record's organization, never merely
 * the first row returned (note 7180167601 on objectstack#35490): under the
 * `group` posture a member reads one row per organization they belong to.
 *
 * `record` decides. When it carries `organization_id` (a stamp, or an explicit
 * `null` under `single`), only the row of that organization answers. When it
 * does not carry the key at all, the organization is unknown, and only a code
 * with exactly one readable row answers: guessing between two organizations'
 * rows would show one organization's setting on another's record.
 */
export function pickRowForOrganization<R extends { code?: unknown; organization_id?: unknown }>(
  rows: readonly R[] | undefined,
  code: string,
  record?: Readonly<Record<string, unknown>> | null,
): R | undefined {
  if (!rows) return undefined;
  const candidates = rows.filter((row) => row?.code === code);
  if (candidates.length === 0) return undefined;
  if (record && Object.prototype.hasOwnProperty.call(record, 'organization_id')) {
    const organization = organizationOf(record as { organization_id?: unknown });
    return candidates.find((row) => organizationOf(row) === organization);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** A whole number of decimal places from 0 to 12 (`UNIT_DECIMAL_PLACES_MAX`), or `undefined`. */
function decimalPlaces(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 12 ? n : undefined;
}

/**
 * What `code` displays as on `record`, read against the rows in `catalog`.
 *
 * `standardLabel` is the platform's label for a standard code in the reader's
 * locale (2A); a caller with none passes `undefined` and the code is shown.
 *
 * A retired organization unit resolves to the bare code with no decimal
 * places (L1: "show the code without a label"), and so does a unit whose row
 * the reader cannot see — an external member holds no `sys_unit` read
 * (comment 7030066814 on objectstack#35490).
 */
export function resolveQuantityUnit(
  code: string,
  catalog: UnitCatalog,
  record?: Readonly<Record<string, unknown>> | null,
  standardLabel?: string,
): ResolvedUnit {
  if (standardUnitOf(code)) {
    const setting = pickRowForOrganization(catalog.standardUnitSettings, code, record);
    const decimals = decimalPlaces(setting?.decimal_places);
    return {
      code,
      standard: true,
      ...(standardLabel ? { label: standardLabel } : {}),
      ...(decimals !== undefined ? { decimals } : {}),
    };
  }
  const row = pickRowForOrganization(catalog.organizationUnits, code, record);
  if (!row || row.retired === true) return { code, standard: false };
  const label = typeof row.label === 'string' && row.label.trim() !== '' ? row.label : undefined;
  const decimals = decimalPlaces(row.decimal_places);
  return {
    code,
    standard: false,
    ...(label ? { label } : {}),
    ...(decimals !== undefined ? { decimals } : {}),
  };
}

/**
 * What the shown quantity columns need on their rows (ADR-0158), for a host
 * that builds a projection: each `record`-mode quantity's `unitField`, and
 * `organization_id` once when any shown column draws a unit, since the
 * organization picks a unit's setting row ({@link pickRowForOrganization}).
 * A column authored `hidden: true` pulls nothing. The host still applies its
 * own gates (a declared field, one the principal may read) to the output.
 */
export function shownQuantityUnitReads(
  columns: unknown,
  fields: Readonly<Record<string, unknown>> | null | undefined,
): string[] {
  if (!Array.isArray(columns) || !fields || typeof fields !== 'object') return [];
  const out = new Set<string>();
  for (const entry of columns) {
    if (entry && typeof entry === 'object' && (entry as { hidden?: unknown }).hidden === true) continue;
    const name = columnIdentity(entry);
    const def = name ? (fields[name] as UnitBearingField | undefined) : undefined;
    if (!declaresQuantityUnit(def)) continue;
    const read = quantityUnitReadField(def);
    if (read) out.add(read);
    out.add('organization_id');
  }
  return [...out];
}

/* ── the unit picker (ADR-0158 Open item 8, objectstack#37471) ─────────── */

/** Whether `field` is a `text` field that holds a unit code (`unitMode: 'code'`). */
export function declaresUnitCode(field: UnitBearingField | null | undefined): boolean {
  return field?.type === 'text' && declaresQuantityUnit(field);
}

/** The `unitDimension` a `unitConfig` restricts its units to, if any. */
function unitDimensionOf(config: unknown): string | undefined {
  const dimension = (config as { unitDimension?: unknown } | null | undefined)?.unitDimension;
  return typeof dimension === 'string' && dimension !== '' ? dimension : undefined;
}

/**
 * The unit code fields a set of form fields declares by POINTER: the
 * `unitField` of every `record`-mode quantity among them, mapped to the
 * quantity's `unitDimension` (ADR-0158: "the field a `record` quantity's
 * `unitField` names is a unit code field by that pointer, so it declares
 * nothing itself"). Each entry is a field's metadata (a form hands its
 * fields' metadata, read off the config's `.field` stash where it has one).
 */
export function quantityUnitCodePointers(fields: readonly unknown[] | null | undefined): Map<string, { unitDimension?: string }> {
  const pointers = new Map<string, { unitDimension?: string }>();
  for (const entry of fields ?? []) {
    const meta = entry as UnitBearingField | null;
    const config = meta?.unitConfig as { unitMode?: unknown; unitField?: unknown } | undefined;
    if (meta?.type !== 'number' || config?.unitMode !== 'record' || typeof config.unitField !== 'string') continue;
    const dimension = unitDimensionOf(config);
    pointers.set(config.unitField, dimension ? { unitDimension: dimension } : {});
  }
  return pointers;
}

/**
 * `field` as a unit code field when a quantity points at it: a copy carrying
 * `unitConfig: { unitMode: 'code' }` (and the quantity's `unitDimension`), so
 * the text widget draws the unit picker. A field that declares its own
 * `unitConfig`, or that nothing points at, comes back unchanged.
 */
export function withUnitCodePointer<F>(field: F, pointer: { unitDimension?: string } | undefined): F {
  if (!pointer || field === null || typeof field !== 'object') return field;
  if ((field as UnitBearingField).unitConfig !== undefined) return field;
  return { ...field, unitConfig: { unitMode: 'code', ...pointer } };
}

/** One choice the unit picker offers. */
export interface UnitPickerOption {
  /** The code the field stores. */
  code: string;
  /** The name shown: the unit's label, or its code when it has none. */
  label: string;
  /** A standard (U1) code, as opposed to one of the organization's own. */
  standard: boolean;
}

/**
 * The units a unit code field may hold, as the server's write check accepts
 * them: the organization's non-retired `sys_unit` rows, then every standard
 * code, each restricted to `unitDimension` when the field declares one. The
 * organization's rows are the record's own organization's when the record
 * carries one (as `pickRowForOrganization` chooses), else every readable row.
 * `standardLabel` names a standard code in the reader's language.
 */
export function unitPickerOptions(
  catalog: UnitCatalog,
  record: Readonly<Record<string, unknown>> | null | undefined,
  standardLabel: (code: string) => string | undefined,
  unitConfig?: unknown,
): UnitPickerOption[] {
  const dimension = unitDimensionOf(unitConfig);
  const scoped = record && Object.prototype.hasOwnProperty.call(record, 'organization_id');
  const organization = scoped ? organizationOf(record as { organization_id?: unknown }) : undefined;
  const own: UnitPickerOption[] = [];
  const seen = new Set<string>();
  for (const row of catalog.organizationUnits ?? []) {
    const code = row?.code;
    if (typeof code !== 'string' || code === '' || row.retired === true || seen.has(code)) continue;
    if (scoped && organizationOf(row) !== organization) continue;
    if (dimension && row.dimension !== dimension) continue;
    seen.add(code);
    own.push({ code, label: typeof row.label === 'string' && row.label !== '' ? row.label : code, standard: false });
  }
  const standard = Object.entries(STANDARD_UNITS)
    .filter(([, unit]) => !dimension || unit.dimension === dimension)
    .map(([code]) => ({ code, label: standardLabel(code) ?? code, standard: true }));
  return [...own, ...standard];
}
