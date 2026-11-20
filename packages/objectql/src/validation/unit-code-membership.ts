// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U5; Open items 3, 8 and 9] A unit code is stored only when it is
 * a member: a standard code (U1, `STANDARD_UNITS`) or one of the
 * organization's own units (`sys_unit`, U3) that is not retired, in exact
 * uppercase (U4).
 *
 * A `number` field declaring `unitConfig: { unitMode: 'record', unitField }`
 * holds a bare quantity (ADR-0104 D1) whose unit is the code in the sibling
 * `text` field `unitField` names. A `text` field declaring
 * `unitConfig: { unitMode: 'code' }` holds a unit code with no quantity beside
 * it (Open item 8, ruled A). Both kinds of code field are judged here. A
 * `fixed` quantity's unit is checked at build (`UnitConfigSchema`,
 * `@objectstack/spec`), so nothing of it is judged at write.
 *
 * This is not the `valueDomain` predicate, which stays pure (U5): membership
 * reads the organization's rows, so the engine reads them once per write
 * ({@link readOrganizationUnits}) and this module judges each row against
 * that answer synchronously ({@link assertUnitCodes}).
 *
 * ## Which writes are judged (Open item 9, settled 7013996288 on #35467)
 *
 * The row IMAGE after the write: the insert row as stored, or the stored row
 * with the update payload laid over it — the image
 * `record-currency-code.ts` judges. For one code field and the quantities
 * pointing at it:
 *
 *  1. **A code written** (the insert row holds one, or the update payload
 *     carries the code field) is admitted only when it is a member, in exact
 *     uppercase. A lower-case or padded spelling is refused, never folded: the
 *     stored code is always the one submitted.
 *  2. **A quantity written beside a resting code** (the payload carries a
 *     non-blank quantity and not the code field) is refused when that code is
 *     no longer a member — an organization unit since retired, or free text
 *     stored before the quantity declared its unit. A blank quantity written
 *     beside a resting code is not judged: a code beside a blank quantity is
 *     judged by point 1 only.
 *  3. **A quantity beside a blank code** is refused for every pair (quantity,
 *     code field) the write touches — its payload carries either — when the
 *     quantity holds a value, mirroring ADR-0144 D8 rule 4
 *     (`ERR_CURRENCY_CODE_REQUIRED`). A blank quantity needs no code.
 *  4. **The dimension restriction** (`unitDimension`, declared on a quantity
 *     or on a standalone code field): a member of another dimension is
 *     refused, wherever point 1 or 2 judges membership.
 *
 * A write that touches neither the code field nor a quantity pointing at it
 * is not judged (ADR-0113 D1): a row resting on a retired unit stays editable
 * in its other fields. A standalone code field has no quantity, so points 2
 * and 3 never apply to it.
 *
 * ## The answers
 *
 * One ADR-0112 code per remedy, each 400, registered under
 * `@objectstack/objectql` (ADR-0158 Open item 3): {@link UNIT_CODE_REQUIRED_CODE},
 * {@link UNIT_CODE_UNKNOWN_CODE}, {@link UNIT_CODE_RETIRED_CODE},
 * {@link UNIT_DIMENSION_MISMATCH_CODE}. A top-level code rather than a
 * field-level `VALIDATION_FAILED` entry for the reason
 * `ERR_CURRENCY_CODE_REQUIRED` is one: the ADR assigns these refusals to
 * ADR-0112's vocabulary. The message prints a code only when the write itself
 * carried it; a resting code is named by its field, never by its value nor by
 * anything derived from it — no spelling correction (`write 'KGM'` beside a
 * stored `kgm`, `'H87'` beside a stored `EA`) and no dimension, since either
 * would tell a caller who may edit the quantity but not read the code field
 * what the field holds. A resting code that is no unit code, and a resting
 * blank, also name the run that converts stored free text
 * ({@link unitCodeBackfillRemedy}, Open item 9 point 7).
 */

import { standardUnitOf, UNIT_DIMENSION_BASE_CODES, type StandardUnit } from '@objectstack/spec/data';

/** The ADR-0112 `code` a quantity beside a blank unit code is refused with (Open item 9, case 3). */
export const UNIT_CODE_REQUIRED_CODE = 'ERR_UNIT_CODE_REQUIRED' as const;
/** The ADR-0112 `code` a code that is no member of U1 or the organization's units is refused with. */
export const UNIT_CODE_UNKNOWN_CODE = 'ERR_UNIT_CODE_UNKNOWN' as const;
/** The ADR-0112 `code` a retired organization unit's code is refused with (L1, Open item 11). */
export const UNIT_CODE_RETIRED_CODE = 'ERR_UNIT_CODE_RETIRED' as const;
/** The ADR-0112 `code` a member of another dimension than the declared `unitDimension` is refused with. */
export const UNIT_DIMENSION_MISMATCH_CODE = 'ERR_UNIT_DIMENSION_MISMATCH' as const;

/** The object an organization's own units live in (ADR-0158 U3). */
export const ORGANIZATION_UNIT_OBJECT = 'sys_unit' as const;

export type UnitCodeRefusalCode =
  | typeof UNIT_CODE_REQUIRED_CODE
  | typeof UNIT_CODE_UNKNOWN_CODE
  | typeof UNIT_CODE_RETIRED_CODE
  | typeof UNIT_DIMENSION_MISMATCH_CODE;

/**
 * One field holding a unit code, and what declares it: the `record`-mode
 * quantities whose `unitField` names it, or its own `unitMode: 'code'`
 * marker (a standalone unit field, Open item 8).
 */
export interface UnitCodeSource {
  /** The `text` field that holds the code. */
  readonly codeField: string;
  /** The `number` fields whose `unitConfig.unitField` names {@link codeField}; empty for a standalone field. */
  readonly quantityFields: readonly string[];
  /** The declared `unitDimension` restricting the code, when one is declared. */
  readonly dimension?: string;
}

/**
 * Every unit code field an object's field map declares, in declaration order.
 * A pointer is answered as written: a `unitField` the spec would refuse (a
 * path, a name no row holds) names a column no row holds, so a quantity
 * pointing through it reads a blank code and is refused, never stored without
 * a unit.
 */
export function unitCodeSources(fields: unknown): UnitCodeSource[] {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const byField = new Map<string, { quantityFields: string[]; dimension?: string }>();
  const entry = (codeField: string) => {
    let hit = byField.get(codeField);
    if (!hit) {
      hit = { quantityFields: [] };
      byField.set(codeField, hit);
    }
    return hit;
  };
  for (const [name, def] of Object.entries(fields as Record<string, unknown>)) {
    if (def === null || typeof def !== 'object') continue;
    const { type, unitConfig } = def as { type?: unknown; unitConfig?: unknown };
    if (unitConfig === null || typeof unitConfig !== 'object') continue;
    const { unitMode, unitField, unitDimension } = unitConfig as { unitMode?: unknown; unitField?: unknown; unitDimension?: unknown };
    const dimension = typeof unitDimension === 'string' && unitDimension !== '' ? unitDimension : undefined;
    if (type === 'number' && unitMode === 'record' && typeof unitField === 'string' && unitField !== '') {
      const hit = entry(unitField);
      hit.quantityFields.push(name);
      if (hit.dimension === undefined && dimension !== undefined) hit.dimension = dimension;
    } else if (type === 'text' && unitMode === 'code') {
      const hit = entry(name);
      if (hit.dimension === undefined && dimension !== undefined) hit.dimension = dimension;
    }
  }
  return [...byField].map(([codeField, { quantityFields, dimension }]) => ({
    codeField,
    quantityFields,
    ...(dimension !== undefined ? { dimension } : {}),
  }));
}

/** Is a quantity or a code blank — absent, `null`, or a string with no characters but white space? */
export function isUnitValueBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

const has = (payload: Record<string, unknown> | null | undefined, key: string): boolean =>
  payload != null && Object.prototype.hasOwnProperty.call(payload, key);

/**
 * What one write asks of one source on one image: whether it judges the
 * code's membership, and which quantities stand beside a blank code.
 * `touched` is an update's payload; omitted on insert, where the whole row is
 * written.
 */
function judgedOf(
  source: UnitCodeSource,
  image: Record<string, unknown>,
  touched: Record<string, unknown> | null | undefined,
  operation: 'insert' | 'update',
): { membership: boolean; codeWritten: boolean; required: string[] } {
  const insert = operation === 'insert';
  const codeWritten = insert || has(touched, source.codeField);
  const code = image[source.codeField];
  if (isUnitValueBlank(code)) {
    // Point 3: every touched pair whose quantity holds a value.
    const required = source.quantityFields.filter(
      (q) => (codeWritten || has(touched, q)) && !isUnitValueBlank(image[q]),
    );
    return { membership: false, codeWritten, required };
  }
  // Points 1 and 2: a code written, or a non-blank quantity written beside a resting one.
  const quantityWritten = source.quantityFields.some((q) => (insert || has(touched, q)) && !isUnitValueBlank(image[q]));
  return { membership: codeWritten || quantityWritten, codeWritten, required: [] };
}

/** One of the organization's own units, as {@link assertUnitCodes} reads it. */
export interface OrganizationUnit {
  readonly dimension: string;
  readonly retired: boolean;
}

/** Reads the organization's `sys_unit` rows whose `code` is one of `codes`. */
export type OrganizationUnitRowsReader = (
  organizationId: string,
  codes: readonly string[],
) => Promise<ReadonlyArray<Record<string, unknown>>>;

/** The organization units a write's images name: `undefined` when the organization holds no such unit. */
export type OrganizationUnitLookup = (organizationId: string | undefined, code: string) => OrganizationUnit | undefined;

const NO_UNITS: OrganizationUnitLookup = () => undefined;

/** The spelling a code differs from only by case or padding, for the refusal's hint. */
const canonicalSpelling = (code: string): string => code.trim().toUpperCase();

/**
 * Read, once per organization for a whole write, the organization units the
 * judged images name — and, for the refusal's hint, the exact-uppercase
 * spelling of each code that is not one. A standard code is never read
 * (no organization code can collide with one: `ORGANIZATION_UNIT_CODE_PATTERN`).
 * Free when the object declares no unit code field, or no judged image names
 * a non-standard code: nothing is read.
 *
 * An image with no organization (`organizationOf` answers `undefined`) has no
 * organization units, so only a standard code is a member there; nothing is
 * read for it, and no other organization's rows are ever consulted.
 */
export async function readOrganizationUnits(
  fields: unknown,
  entries: Iterable<{
    readonly image: Record<string, unknown> | null | undefined;
    readonly touched?: Record<string, unknown> | null;
    readonly organizationId: string | undefined;
  }>,
  operation: 'insert' | 'update',
  readRows: OrganizationUnitRowsReader | undefined,
): Promise<OrganizationUnitLookup> {
  const sources = unitCodeSources(fields);
  if (sources.length === 0 || !readRows) return NO_UNITS;
  const wanted = new Map<string, Set<string>>();
  for (const { image, touched, organizationId } of entries) {
    if (!image || typeof image !== 'object' || organizationId === undefined) continue;
    for (const source of sources) {
      if (!judgedOf(source, image, touched, operation).membership) continue;
      const code = image[source.codeField];
      if (typeof code !== 'string' || standardUnitOf(code) !== undefined) continue;
      let codes = wanted.get(organizationId);
      if (!codes) {
        codes = new Set();
        wanted.set(organizationId, codes);
      }
      codes.add(code);
      codes.add(canonicalSpelling(code));
    }
  }
  if (wanted.size === 0) return NO_UNITS;
  const units = new Map<string, Map<string, OrganizationUnit>>();
  for (const [organizationId, codes] of wanted) {
    const rows = await readRows(organizationId, [...codes]);
    const own = new Map<string, OrganizationUnit>();
    for (const row of Array.isArray(rows) ? rows : []) {
      const code = row?.code;
      if (typeof code !== 'string') continue;
      own.set(code, { dimension: String(row.dimension ?? ''), retired: row.retired === true || row.retired === 1 });
    }
    units.set(organizationId, own);
  }
  return (organizationId, code) =>
    organizationId === undefined ? undefined : units.get(organizationId)?.get(code);
}

/** The dimension of a member code, or why it is not one. */
type Membership =
  | { readonly kind: 'member'; readonly dimension: string }
  | { readonly kind: 'retired' }
  | { readonly kind: 'unknown'; readonly hint?: string };

function membershipOf(code: unknown, organizationId: string | undefined, lookup: OrganizationUnitLookup): Membership {
  if (typeof code !== 'string') return { kind: 'unknown' };
  const standard: StandardUnit | undefined = standardUnitOf(code);
  if (standard) return { kind: 'member', dimension: standard.dimension };
  const own = lookup(organizationId, code);
  if (own) return own.retired ? { kind: 'retired' } : { kind: 'member', dimension: own.dimension };
  // Not a member. The hint names an exact spelling that is one.
  const canonical = canonicalSpelling(code);
  if (canonical !== code) {
    const near = standardUnitOf(canonical) ?? lookup(organizationId, canonical);
    if (near && !('retired' in near && near.retired)) return { kind: 'unknown', hint: canonical };
  }
  if (canonical === 'C62' || canonical === 'EA') return { kind: 'unknown', hint: 'H87' };
  return { kind: 'unknown' };
}

/** A code of `dimension`, for a refusal's example: its base unit, or a package code. */
function exampleCodeOf(dimension: string): string {
  return Object.prototype.hasOwnProperty.call(UNIT_DIMENSION_BASE_CODES, dimension)
    ? (UNIT_DIMENSION_BASE_CODES as Record<string, string>)[dimension]!
    : 'XBX';
}

/**
 * One refused unit code — see the module header. Identified by `code`, which
 * survives crossing package boundaries; `status` is 400 for each.
 */
export class RecordUnitCodeError extends Error {
  readonly code: UnitCodeRefusalCode;
  readonly status = 400;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. */
  readonly httpStatus = 400;
  /** The object written. */
  readonly object: string;
  /** The unit code field refused. */
  readonly field: string;
  /** The quantity beside it, when the refusal is about a quantity's unit. */
  readonly quantityField?: string;

  constructor(code: UnitCodeRefusalCode, message: string, object: string, field: string, quantityField?: string) {
    super(message);
    this.name = 'RecordUnitCodeError';
    this.code = code;
    this.object = object;
    this.field = field;
    if (quantityField !== undefined) this.quantityField = quantityField;
  }
}

/** Is `e` one of this module's refusals? The `validate()` preview answers it as the row's finding. */
export function isUnitCodeRefusal(e: unknown): e is RecordUnitCodeError {
  return e instanceof RecordUnitCodeError;
}

/**
 * Refuse a row image whose unit code is not a member, or whose quantity
 * stands beside a blank code — see the module header.
 *
 * @param image    the row as it will be stored (insert row, or stored row ⊕ payload)
 * @param touched  an update's payload; omitted on insert, where the whole row is judged
 * @param organizationId the organization the row is stored under, whose units are members
 * @param lookup   the organization units {@link readOrganizationUnits} read for this write
 */
export function assertUnitCodes(
  object: string,
  fields: unknown,
  image: Record<string, unknown> | null | undefined,
  operation: 'insert' | 'update',
  touched: Record<string, unknown> | null | undefined,
  recordId: unknown,
  organizationId: string | undefined,
  lookup: OrganizationUnitLookup,
): void {
  if (!image || typeof image !== 'object') return;
  const sources = unitCodeSources(fields);
  if (sources.length === 0) return;
  const row = recordId === undefined || recordId === null ? '' : ` (record ${String(recordId)})`;
  const head = `${operation === 'insert' ? 'Insert' : 'Update'} on '${object}'${row} was REFUSED: `;
  for (const source of sources) {
    const { membership, codeWritten, required } = judgedOf(source, image, touched, operation);
    const { codeField } = source;
    if (required.length > 0) {
      const [quantity] = required;
      const also = required.length > 1 ? ` (also: ${required.slice(1).map((q) => `'${q}'`).join(', ')})` : '';
      throw new RecordUnitCodeError(
        UNIT_CODE_REQUIRED_CODE,
        `${head}'${quantity}' holds a quantity in the unit its record names (unitMode: 'record'), and its unit code `
          + `field '${codeField}' is blank${also}. The row was not written. Write the record's unit code (for example `
          + `'${source.dimension ? exampleCodeOf(source.dimension) : 'KGM'}') into '${codeField}' in the same write, or `
          + `leave '${quantity}' empty. The server never fills a unit in.`
          + (codeWritten ? '' : unitCodeBackfillRemedy(object, codeField, true)),
        object, codeField, quantity,
      );
    }
    if (!membership) continue;
    const code = image[codeField];
    const verdict = membershipOf(code, organizationId, lookup);
    // A code the write carried is named; a resting one is named by its field only,
    // and nothing derived from it (its corrected spelling, its dimension) is printed.
    const named = codeWritten && typeof code === 'string' ? `'${code}'` : 'a code stored before this write';
    const quantity = source.quantityFields.find((q) => !isUnitValueBlank(image[q]));
    const remedyTail = codeWritten
      ? ''
      : quantity !== undefined
        ? ` Move the record to an existing unit: write a member code into '${codeField}' in the same write as '${quantity}'.`
        : '';
    if (verdict.kind === 'unknown') {
      throw new RecordUnitCodeError(
        UNIT_CODE_UNKNOWN_CODE,
        `${head}'${codeField}' holds ${named}, which is not a unit code: a unit code is a standard UN/ECE `
          + `Recommendation 20 code (for example 'KGM', 'MTR', 'H87') or one of the organization's own units, `
          + 'in exact uppercase. The row was not written. '
          + (codeWritten && verdict.hint !== undefined
            ? verdict.hint === 'H87' && typeof code === 'string' && canonicalSpelling(code) !== 'H87'
              ? `The piece is 'H87'; write 'H87'.`
              : `Codes are exact uppercase with no spaces; write '${verdict.hint}'.`
            : 'Write a standard code, or add the unit to the organization\'s Units of Measure first.')
          + remedyTail
          + (codeWritten ? '' : unitCodeBackfillRemedy(object, codeField, false)),
        object, codeField, quantity,
      );
    }
    if (verdict.kind === 'retired') {
      throw new RecordUnitCodeError(
        UNIT_CODE_RETIRED_CODE,
        `${head}'${codeField}' holds ${named}, a unit of this organization that is retired. A retired unit is never `
          + 'used again, and its code is never created again. The row was not written. Write another unit\'s code '
          + `into '${codeField}'` + (quantity !== undefined ? ` in the same write as '${quantity}'.` : '.'),
        object, codeField, quantity,
      );
    }
    if (source.dimension !== undefined && verdict.dimension !== source.dimension) {
      const declarer = source.quantityFields.length > 0 ? `the quantity '${source.quantityFields[0]}'` : `'${codeField}'`;
      // A resting code's dimension is derived from it, so only a written one is named.
      const ofDimension = codeWritten ? `a unit of the ${verdict.dimension} dimension` : 'a unit of another dimension';
      throw new RecordUnitCodeError(
        UNIT_DIMENSION_MISMATCH_CODE,
        `${head}'${codeField}' holds ${named}, ${ofDimension}, and ${declarer} declares `
          + `unitDimension '${source.dimension}'. The row was not written. Write a ${source.dimension} unit (for example `
          + `'${exampleCodeOf(source.dimension)}') into '${codeField}'`
          + (!codeWritten && quantity !== undefined ? ` in the same write as '${quantity}'.` : '.'),
        object, codeField, quantity,
      );
    }
  }
}

/**
 * [ADR-0158 Open item 9 point 7] The run that converts a field's stored free
 * text into codes, named by the two refusals a resting value can cause: a
 * quantity written beside a resting code that is no unit code, or beside a
 * resting blank (`unit-code-backfill.ts`, `os migrate unit-codes` and its REST
 * twin). Never a written code's remedy: that writer chose the value. The
 * metadata save's `unit_mode_to_record` / `unit_mode_to_code` finding names
 * the same run (`@objectstack/metadata-protocol`, `protocol-write-face.ts`).
 */
export function unitCodeBackfillRemedy(object: string, codeField: string, blank: boolean): string {
  return ` Rows stored before '${codeField}' was a unit code field are converted all at once by an organization admin, `
    + `from a mapping of each stored text to its code, with \`os migrate unit-codes --object ${object} --field ${codeField} `
    + '--map-file <mapping file>`' + (blank ? ' (an entry "" gives a blank unit beside a quantity its code)' : '')
    + ' or `POST /api/v1/meta/_migrate-unit-codes`: a dry run lists each stored value, and --apply (or "apply": true) writes.';
}

/** Does an update payload touch any unit code field, or a quantity pointing at one? */
export function touchesUnitCodes(fields: unknown, payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  return unitCodeSources(fields).some(
    (s) => has(payload, s.codeField) || s.quantityFields.some((q) => has(payload, q)),
  );
}

/**
 * The engine's {@link OrganizationUnitRowsReader}: the organization's
 * `sys_unit` rows, read under system identity for that one organization. A
 * member who writes a quantity holds read on the units anyway
 * (`member_default`); elevation keeps a field-level or row-level read
 * restriction from turning a member code into an unknown one.
 *
 * Nothing of the caller's scope rides along but its transaction and trace,
 * the posture `organizationCountContext` takes (`engine-cascade-planning.ts`):
 * the caller's accessible organizations would widen the driver's tenant
 * scope to all of them, and a `single` posture applies none. So the read
 * names the organization twice — as the context's `tenantId` and as an
 * explicit `organization_id` predicate — and one organization's units never
 * admit a code on another's row. An install without the object registered
 * has no organization units.
 */
export function organizationUnitRowsOf(
  host: {
    readonly _registry: { getObject(name: string): unknown };
    find(object: string, query: Record<string, unknown>): Promise<unknown>;
  },
  context: Record<string, unknown> | undefined,
): OrganizationUnitRowsReader {
  return async (organizationId, codes) => {
    if (!host._registry.getObject(ORGANIZATION_UNIT_OBJECT)) return [];
    const rows = await host.find(ORGANIZATION_UNIT_OBJECT, {
      where: { organization_id: organizationId, code: { $in: [...codes] } },
      fields: ['code', 'dimension', 'retired'],
      context: {
        isSystem: true,
        tenantId: organizationId,
        ...(context?.transaction !== undefined ? { transaction: context.transaction } : {}),
        ...(context?.traceId !== undefined ? { traceId: context.traceId } : {}),
      },
    });
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  };
}

/** The ADR-0112 `code` a delete of a `sys_unit` row is refused with. */
export const UNIT_DELETE_REFUSED_CODE = 'ERR_UNIT_DELETE_REFUSED' as const;

/**
 * [ADR-0158 Open item 11; L1] A `sys_unit` row is never deleted, in any
 * context. Retiring is the delete (the row's one-way `retired` flag): the row
 * keeps holding its organization-scoped unique `code`, so the code can never
 * be created again with another dimension, ratio or label, and a quantity
 * resting on it never takes a stranger's meaning. A removed row would free
 * that key.
 *
 * The data API serves no `delete` on the object (`apiMethods`, 405
 * `OBJECT_API_METHOD_NOT_ALLOWED`) and Setup offers none (`userActions`); this
 * is the engine's refusal under both, for every caller the engine serves — a
 * user, a system writer (`isSystem: true`, which the security middleware lets
 * through untouched) and an automation run. 405, the status the data door
 * answers the same verb on this object with.
 */
export class UnitDeleteRefusedError extends Error {
  readonly code = UNIT_DELETE_REFUSED_CODE;
  readonly status = 405;
  /** The same number under ADR-0112 D5's spelling. */
  readonly httpStatus = 405;
  readonly object = ORGANIZATION_UNIT_OBJECT;

  constructor() {
    super(
      `Delete on '${ORGANIZATION_UNIT_OBJECT}' was REFUSED: a unit of measure is never deleted. Retire it instead ` +
        '(set `retired: true`): a retired unit keeps its code, so the code is never created again with another ' +
        'meaning, and records already in that unit keep it. Nothing was deleted.',
    );
    this.name = 'UnitDeleteRefusedError';
  }
}

/**
 * Refuse a delete of `object` when it is `sys_unit` — see
 * {@link UnitDeleteRefusedError}. Called by the engine's `delete()` before any
 * middleware or hook runs, for a by-id, a predicate (`multi`) and a permanent
 * delete alike.
 */
export function refuseOrganizationUnitDelete(object: string): void {
  if (object === ORGANIZATION_UNIT_OBJECT) throw new UnitDeleteRefusedError();
}
