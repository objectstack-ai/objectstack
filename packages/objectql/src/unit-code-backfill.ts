// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The explicit conversion of the free text a unit code field stored before it
 * was declared a unit code field — `os migrate unit-codes` and its REST twin
 * `POST /meta/_migrate-unit-codes` (ADR-0158 U7 R1; Open item 12, the backfill
 * half, settled on its card under the owning seat; Open item 8, ruled A).
 *
 * ## The hole this fills
 *
 * A `text` column such as `uom` holds whatever its writers typed — `kg`, `KG`,
 * `公斤`. Once a quantity names it (`unitConfig: { unitMode: 'record',
 * unitField }`), or it declares itself a standalone unit field
 * (`unitConfig: { unitMode: 'code' }`), the write check
 * (`validation/unit-code-membership.ts`, U5) admits only a member code, and a
 * quantity edited beside a resting non-member is refused (Open item 9, case 2).
 * The metadata save that makes that declaration answers 409 `destructive_change`
 * naming this run. This run rewrites the stored text, in place, into codes.
 *
 * ## The mapping is the operator's, never derived
 *
 * The caller supplies `mapping`: stored text, exactly as written, to a unit
 * code. ⛔ No synonym table guesses that `公斤` is `KGM` (U1 is the one shipped
 * list), the currency backfill's rule (`record-currency-backfill.ts`). Matching
 * is exact: `kg`, `KG` and `kg ` are three keys. The entry `""` is the one
 * spelling for a blank unit beside a non-blank quantity, which is not free
 * text: such a row is written only from that entry, else counted and left
 * (refused at its next write of the pair, Open item 9 case 3).
 *
 * ## Which rows, and judged when
 *
 * - Every mapping target is judged by U5's membership and the field's
 *   `unitDimension` BEFORE any row is read: a standard code here, and an
 *   organization's own code in that organization when the run names one. An
 *   unscoped or all-organizations run judges an organization code in each
 *   organization it would write it in, after the read-only count and before
 *   any write. A non-member target refuses the whole run.
 * - A row holding a unit code is never touched: a code of U1, or any unit of
 *   the row's organization (the settlement's membership, "U1, or that
 *   organization's `sys_unit` rows"), a retired one included, since L1 keeps a
 *   resting row's code and its quantity is in that unit. A code of another
 *   dimension than `unitDimension` is a code too. Neither is free text, and
 *   rewriting them from a mapping would change what the stored quantity means.
 *   Neither is a code the field admits either: beside a quantity, the write
 *   check answers both at the row's next quantity edit; a standalone field has
 *   no quantity, so the resting code is never judged at rest, and the next
 *   write of the field must carry another code. So each is listed and counted
 *   apart from the codes the field admits (`retired`, `other-dimension`;
 *   `skippedRetired`, `skippedOtherDimension`), and so is a blank beside a
 *   quantity the mapping has no `""` entry for (`blankBesideQuantity`, refused
 *   at its next quantity edit). A run that leaves any of them is not complete
 *   (`unitCodeBackfillComplete`). A blank code with no quantity value beside
 *   it is left alone, owed nothing.
 * - Every distinct stored value is listed with its row count, so the operator
 *   sees each spelling before writing.
 * - An apply run counts first, read-only, and refuses before any write while a
 *   non-blank value that is no unit code has no mapping entry, naming each one. So one
 *   apply run converts the whole field or nothing, and a re-run writes nothing.
 *
 * The walk reads each row and tallies and tests its value here, in the
 * application, never in a `GROUP BY` or an anti-join on `sys_unit`: matching is
 * exact, which a database collation does not guarantee (a case-insensitive or
 * pad-space collation merges `kg`, `KG` and `kg `); a blank is judged here for
 * the currency backfill's reason (null comparison is where drivers diverge);
 * and each converted row is written by its id, so the write check judges
 * every code.
 *
 * Writes go through `engine.update`, one per row, as the currency backfill's
 * do: the write check judges each converted code like any caller's, audited and
 * hooked. Scope mirrors the currency backfill as ruled (ADR-0144 Open item 13,
 * ruling 6670707546): one organization, or every organization explicitly; an
 * unscoped run over the rows of several organizations is refused with each
 * one's counts. No `sys_migration` flag is recorded: nothing gates on the run.
 */

import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
import { objectNotFoundError, withTransientRetry, type RetryOptions } from '@objectstack/core';
import { standardUnitOf } from '@objectstack/spec/data';

import { isUnitValueBlank, organizationUnitRowsOf, unitCodeSources, type UnitCodeSource } from './validation/unit-code-membership.js';
import { isFederatedUnprovisionedInjectedColumn } from './federated-object.js';
import { rowFailureSentence, type RecordCurrencyBackfillEngine, type RecordCurrencyBackfillFailure, type RecordCurrencyBackfillLogger } from './record-currency-backfill.js';

export type UnitCodeBackfillEngine = RecordCurrencyBackfillEngine;
export type UnitCodeBackfillLogger = RecordCurrencyBackfillLogger;
export type UnitCodeBackfillFailure = RecordCurrencyBackfillFailure;

/** Stored text, exactly as written, to the unit code it becomes; `""` is a blank unit beside a quantity. */
export type UnitCodeMapping = Readonly<Record<string, string>>;

/** One distinct stored value: what the run does with its rows. */
export interface UnitCodeBackfillValue {
  /** The stored text exactly as written; `""` for a blank unit beside a quantity. */
  value: string;
  rows: number;
  /**
   * `member`: a unit code the field admits, never rewritten. `retired`: a
   * retired unit of the row's organization, and `other-dimension`: a unit code
   * of another dimension than the field's `unitDimension` — each left as
   * stored, and no code the field admits: refused at the row's next quantity
   * edit, or, on a standalone field, replaced at the next write of the field.
   * `mapped`: rewritten to `code`. `unmatched`: no entry.
   */
  disposition: 'member' | 'retired' | 'other-dimension' | 'mapped' | 'unmatched';
  code?: string;
}

/** The counts of one organization's rows (`organizationId` null: rows that name none). */
export interface UnitCodeBackfillOrganization {
  organizationId: string | null;
  scannedRecords: number;
  mapped: number;
  written: number;
  unmatched: number;
  /** Rows holding a unit code the field admits. */
  skippedMember: number;
  /** Rows resting on a retired unit (`retired`), left as stored. */
  skippedRetired: number;
  /** Rows holding a unit code of another dimension (`other-dimension`), left as stored. */
  skippedOtherDimension: number;
  /** Blank units with no quantity beside them: owed nothing. */
  skippedBlank: number;
  /** Blank units beside a quantity, left blank because the mapping has no `""` entry. */
  blankBesideQuantity: number;
}

export interface UnitCodeBackfillReport extends Omit<UnitCodeBackfillOrganization, 'organizationId'> {
  object: string;
  /** The organization the run was scoped to, or null. */
  organizationId: string | null;
  allOrganizations: boolean;
  /** The unit code field rewritten. */
  field: string;
  /** The `record`-mode quantities whose `unitField` names it; empty for a standalone field. */
  quantityFields: string[];
  /** Every distinct value met, ordered by value. Rows: `mapped` rewritten, `unmatched` refusing an apply run. */
  values: UnitCodeBackfillValue[];
  /** A few record ids the mapping rewrites. */
  sampleRecordIds: string[];
  applied: boolean;
  truncated: boolean;
  failures: UnitCodeBackfillFailure[];
  organizations: UnitCodeBackfillOrganization[];
}

export interface UnitCodeBackfillOptions {
  object: string;
  /** The unit code field: a `text` field a quantity's `unitField` names, or one declaring `unitMode: 'code'`. */
  field: string;
  /** The operator's mapping. Omitted: none, so a dry run lists every stored value. */
  mapping?: UnitCodeMapping;
  apply?: boolean;
  organizationId?: string;
  allOrganizations?: boolean;
  maxRecords?: number;
  retry?: RetryOptions;
}

const SCAN_PAGE_SIZE = 500;
const MAX_SAMPLE_IDS = 5;
const MAX_NAMED_VALUES = 10;
const SYSTEM_CTX = { isSystem: true } as const;
const BEFORE_READ = 'Refused before the walk read or wrote any row.';

type RefusalError = Error & { code: string; status: number; httpStatus: number; field: string };

/** The refusal of an apply run over unmatched values, each named with its row count. */
export type UnitCodeBackfillUnmatchedRefusal = RefusalError & { unmatched: UnitCodeBackfillValue[] };
/** The refusal of an unscoped run over the rows of several organizations, with each one's counts. */
export type UnitCodeBackfillOrganizationsRefusal = RefusalError & { organizations: UnitCodeBackfillOrganization[] };

function refusalOf(code: string, field: string, message: string): RefusalError {
  return Object.assign(new Error(`[unit-code-backfill] ${message}`), { code, status: 400, httpStatus: 400, field });
}

/**
 * The mapping as a plain object of non-blank codes, or `VALIDATION_ERROR` /
 * 400 on `mapping`. Shared by the CLI (before it opens the database) and the
 * REST door (on the body). A key of white space alone is refused: the blank
 * entry is spelled `""`, and such a key would never match a row.
 */
export function unitCodeMappingOf(input: unknown): UnitCodeMapping {
  if (input === undefined) return {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw refusalOf('VALIDATION_ERROR', 'mapping', 'the mapping must be a JSON object of stored text to unit code, for example { "kg": "KGM" }.');
  }
  const out: Record<string, string> = {};
  for (const [key, target] of Object.entries(input as Record<string, unknown>)) {
    if (key !== '' && key.trim() === '') {
      throw refusalOf('VALIDATION_ERROR', 'mapping', `the key ${JSON.stringify(key)} is white space only: a blank unit is spelled "" in the mapping.`);
    }
    if (typeof target !== 'string' || target.trim() === '') {
      throw refusalOf('VALIDATION_ERROR', 'mapping', `the entry ${JSON.stringify(key)} maps to no unit code: each value is a code, for example "KGM".`);
    }
    out[key] = target;
  }
  return out;
}

/** The unit code field the run rewrites, judged before any row is read. */
function resolveSource(engine: UnitCodeBackfillEngine, object: string, field: string): UnitCodeSource {
  const schema = engine.getObject(object);
  if (!schema) throw objectNotFoundError(object);
  const declared = schema.fields ?? {};
  const sources = unitCodeSources(declared);
  const source = sources.find((s) => s.codeField === field);
  if (source && field in declared) return source;
  const quantityOf = sources.find((s) => s.quantityFields.includes(field));
  throw refusalOf(
    'INVALID_FIELD',
    field,
    `'${object}.${field}' is not a unit code field: ` +
      (quantityOf
        ? `it is a quantity, whose unit code is stored in '${quantityOf.codeField}'; name that field. `
        : field in declared
          ? 'no quantity names it in unitConfig.unitField, and it declares no unitConfig: { unitMode: \'code\' }. '
          : `'${object}' declares no field '${field}'. `) +
      BEFORE_READ,
  );
}

/** The scope options, judged before any row is read. Answers the organization column, when the object stores one. */
function resolveScope(engine: UnitCodeBackfillEngine, options: UnitCodeBackfillOptions): string | undefined {
  const { object, organizationId } = options;
  if (organizationId !== undefined && options.allOrganizations === true) {
    throw refusalOf('VALIDATION_ERROR', 'organizationId', `name one organization or all of them, not both. ${BEFORE_READ}`);
  }
  if (organizationId !== undefined && organizationId.trim() === '') {
    throw refusalOf('VALIDATION_ERROR', 'organizationId', `the organization id is blank. ${BEFORE_READ}`);
  }
  const schema = engine.getObject(object);
  const column = 'organization_id' in (schema?.fields ?? {}) && !isFederatedUnprovisionedInjectedColumn(schema, 'organization_id')
    ? 'organization_id'
    : undefined;
  if (organizationId !== undefined && column === undefined) {
    throw refusalOf(
      'INVALID_FIELD',
      'organization_id',
      `'${object}' stores no organization_id, so its rows cannot be scoped to '${organizationId}': run it without an organization. ${BEFORE_READ}`,
    );
  }
  return column;
}

/** The organization units a run has read, by organization, read once per code. */
class OrganizationUnits {
  private readonly byOrganization = new Map<string, Map<string, { dimension: string; retired: boolean } | null>>();
  private readonly read: ReturnType<typeof organizationUnitRowsOf>;

  constructor(engine: UnitCodeBackfillEngine) {
    this.read = organizationUnitRowsOf({ _registry: { getObject: (n) => engine.getObject(n) }, find: (o, q) => engine.find(o, q) }, undefined);
  }

  /** Read the codes of `codes` this organization's cache does not hold yet. */
  async load(organizationId: string, codes: Iterable<string>): Promise<void> {
    let known = this.byOrganization.get(organizationId);
    if (!known) this.byOrganization.set(organizationId, (known = new Map()));
    const wanted = [...new Set(codes)].filter((c) => !known!.has(c) && standardUnitOf(c) === undefined);
    if (wanted.length === 0) return;
    for (const code of wanted) known.set(code, null);
    for (const row of await this.read(organizationId, wanted)) {
      if (typeof row?.code !== 'string') continue;
      known.set(row.code, { dimension: String(row.dimension ?? ''), retired: row.retired === true || row.retired === 1 });
    }
  }

  /** The member's dimension, `'retired'`, or undefined for no member (U5; exact uppercase, never folded). */
  verdict(organizationId: string | null, code: string): string | 'retired' | undefined {
    const standard = standardUnitOf(code);
    if (standard) return standard.dimension;
    const own = organizationId === null ? undefined : this.byOrganization.get(organizationId)?.get(code);
    return own ? (own.retired ? 'retired' : own.dimension) : undefined;
  }
}

/** Refuse a mapping target that is no member of `organizationId`, or of another dimension than the field's. */
function judgeTarget(
  source: UnitCodeSource,
  units: OrganizationUnits,
  organizationId: string | null,
  target: string,
  object: string,
  when: string,
): void {
  const verdict = units.verdict(organizationId, target);
  const where = organizationId === null ? 'for rows that name no organization' : `in organization ${organizationId}`;
  const why = verdict === undefined
    ? `is not a unit code ${where}: a unit code is a standard UN/ECE Recommendation 20 code (for example 'KGM') or one of the organization's own units, in exact uppercase`
    : verdict === 'retired'
      ? `is a retired unit ${where}, never used again`
      : source.dimension !== undefined && verdict !== source.dimension
        ? `is a unit of the ${verdict} dimension, and '${object}.${source.codeField}' holds ${source.dimension} units (unitDimension)`
        : undefined;
  if (why !== undefined) {
    throw refusalOf('INVALID_FIELD', source.codeField, `the mapping target '${target}' ${why}, so '${object}.${source.codeField}' would refuse it. ${when}`);
  }
}

/**
 * Rewrite the stored text of the unit code field `options.field` of
 * `options.object` into the codes `options.mapping` names — see the module
 * header. A dry run unless `options.apply`, and a dry run writes nothing.
 * Throws before any row is read for an unknown object (`OBJECT_NOT_FOUND`), a
 * field that is no unit code field, a malformed mapping, a target that is no
 * member, and a bad scope; throws `VALIDATION_ERROR` / 400 before any write for
 * an unscoped run over several organizations (`organizations`) and for an
 * apply run that meets a value with no mapping entry (`unmatched`).
 */
export async function backfillUnitCodes(
  engine: UnitCodeBackfillEngine,
  logger: UnitCodeBackfillLogger,
  options: UnitCodeBackfillOptions,
): Promise<UnitCodeBackfillReport> {
  const source = resolveSource(engine, options.object, options.field);
  const mapping = unitCodeMappingOf(options.mapping);
  const organizationColumn = resolveScope(engine, options);
  const units = new OrganizationUnits(engine);
  const targets = [...new Set(Object.values(mapping))];
  const scoped = options.organizationId ?? null;
  if (scoped !== null) await units.load(scoped, targets);
  for (const target of targets) {
    if (scoped !== null || standardUnitOf(target) !== undefined) {
      judgeTarget(source, units, scoped, target, options.object, BEFORE_READ);
    }
  }

  const preview = await walkUnitCodes(engine, logger, options, source, mapping, units, organizationColumn, false);
  if (scoped === null && options.allOrganizations !== true) {
    const named = preview.report.organizations.filter((o) => o.organizationId !== null);
    if (named.length > 1) throw organizationsRefusal(preview, named.length);
  }
  // An organization code is judged in each organization the run would write it in.
  for (const [organizationId, used] of preview.targetsByOrganization) {
    if (organizationId !== null) await units.load(organizationId, used);
    for (const target of used) {
      if (standardUnitOf(target) === undefined) judgeTarget(source, units, organizationId, target, options.object, 'Refused before any row was written.');
    }
  }
  if (options.apply !== true) return preview.report;
  if (preview.report.unmatched > 0) throw unmatchedRefusal(preview.report);
  return (await walkUnitCodes(engine, logger, options, source, mapping, units, organizationColumn, true)).report;
}

function organizationsRefusal(preview: Walked, count: number): UnitCodeBackfillOrganizationsRefusal {
  const { report } = preview;
  const counts = report.organizations
    .map((o) => `${o.organizationId ?? '(none)'}: ${o.mapped} to rewrite, ${o.unmatched} unmatched`)
    .join('; ');
  return Object.assign(
    refusalOf(
      'VALIDATION_ERROR',
      'organizationId',
      `the rows of '${report.object}' belong to ${count} organizations (${counts}), and each organization has its own units, ` +
        'so one mapping is not known to be right for all of them. Name the organization, one run per organization, or ask ' +
        'for every organization explicitly. Refused before any row was written.',
    ),
    { organizations: report.organizations },
  );
}

function unmatchedRefusal(report: UnitCodeBackfillReport): UnitCodeBackfillUnmatchedRefusal {
  const unmatched = report.values.filter((v) => v.disposition === 'unmatched');
  const named = unmatched.slice(0, MAX_NAMED_VALUES).map((v) => `${JSON.stringify(v.value)} (${v.rows} row(s))`).join(', ');
  const more = unmatched.length > MAX_NAMED_VALUES ? ` and ${unmatched.length - MAX_NAMED_VALUES} more` : '';
  return Object.assign(
    refusalOf(
      'VALIDATION_ERROR',
      'mapping',
      `'${report.object}.${report.field}' holds ${report.unmatched} row(s) whose value is no unit code and has no mapping entry: ` +
        `${named}${more}. Map each value to its unit code, or correct those rows first, so that one run converts the whole ` +
        'field. Refused before any row was written.',
    ),
    { unmatched },
  );
}

interface Walked {
  report: UnitCodeBackfillReport;
  /** The mapping targets each organization's rewritten rows would receive. */
  targetsByOrganization: Map<string | null, Set<string>>;
}

async function walkUnitCodes(
  engine: UnitCodeBackfillEngine,
  logger: UnitCodeBackfillLogger,
  options: UnitCodeBackfillOptions,
  source: UnitCodeSource,
  mapping: UnitCodeMapping,
  units: OrganizationUnits,
  organizationColumn: string | undefined,
  apply: boolean,
): Promise<Walked> {
  const { object, organizationId } = options;
  const { codeField, quantityFields } = source;
  const context = organizationId !== undefined ? { ...SYSTEM_CTX, tenantId: organizationId } : { ...SYSTEM_CTX };
  const counts = (): Omit<UnitCodeBackfillOrganization, 'organizationId'> =>
    ({ scannedRecords: 0, mapped: 0, written: 0, unmatched: 0, skippedMember: 0, skippedRetired: 0, skippedOtherDimension: 0, skippedBlank: 0, blankBesideQuantity: 0 });
  const report: UnitCodeBackfillReport = {
    object, organizationId: organizationId ?? null, allOrganizations: options.allOrganizations === true,
    field: codeField, quantityFields: [...quantityFields], ...counts(), values: [],
    sampleRecordIds: [], applied: apply, truncated: false, failures: [], organizations: [],
  };
  const organizations = new Map<string | null, UnitCodeBackfillOrganization>();
  const values = new Map<string, UnitCodeBackfillValue>();
  const targetsByOrganization = new Map<string | null, Set<string>>();
  const has = (key: string) => Object.prototype.hasOwnProperty.call(mapping, key);
  const organizationOf = (row: Record<string, unknown>): string | null => {
    const own = organizationColumn !== undefined ? row[organizationColumn] : undefined;
    return own === undefined || own === null || own === '' ? (organizationId ?? null) : String(own);
  };

  const walk = keysetWalk<Record<string, unknown>>(
    (q: KeysetPageQuery) => engine.find(object, {
      ...q,
      fields: ['id', ...(organizationColumn !== undefined ? [organizationColumn] : []), codeField, ...quantityFields],
      context: { ...context },
    }),
    {
      pageSize: SCAN_PAGE_SIZE,
      max: options.maxRecords ?? 100_000,
      ...(organizationId !== undefined && organizationColumn !== undefined ? { where: { [organizationColumn]: organizationId } } : {}),
    },
  );

  for await (const page of walk.pages()) {
    // The organization units this page's values name, read once per organization.
    const named = new Map<string, Set<string>>();
    for (const row of page) {
      const org = organizationOf(row);
      const value = row[codeField];
      if (org !== null && typeof value === 'string' && !isUnitValueBlank(value)) {
        if (!named.has(org)) named.set(org, new Set());
        named.get(org)!.add(value);
      }
    }
    for (const [org, codes] of named) await units.load(org, codes);

    for (const row of page) {
      const org = organizationOf(row);
      let tally = organizations.get(org);
      if (!tally) organizations.set(org, (tally = { organizationId: org, ...counts() }));
      const bump = (key: keyof ReturnType<typeof counts>) => { report[key]++; tally![key]++; };
      bump('scannedRecords');
      const id = row.id;
      if (id == null || id === '') continue;
      const stored = row[codeField];
      let value: string;
      if (isUnitValueBlank(stored)) {
        // A blank unit is owed only beside a quantity, and written only from the "" entry.
        if (!quantityFields.some((q) => !isUnitValueBlank(row[q]))) { bump('skippedBlank'); continue; }
        if (!has('')) { bump('blankBesideQuantity'); continue; }
        value = '';
      } else {
        value = typeof stored === 'string' ? stored : String(stored);
        // Any code is left as stored, a retired unit or another dimension included: see the header.
        const verdict = units.verdict(org, value);
        if (verdict !== undefined) {
          const resting = verdict === 'retired'
            ? 'retired'
            : source.dimension !== undefined && verdict !== source.dimension ? 'other-dimension' : 'member';
          bump(resting === 'retired' ? 'skippedRetired' : resting === 'other-dimension' ? 'skippedOtherDimension' : 'skippedMember');
          tallyValue(values, value, resting, mapping);
          continue;
        }
        if (!has(value)) {
          bump('unmatched');
          tallyValue(values, value, 'unmatched', mapping);
          continue;
        }
      }
      const code = mapping[value]!;
      bump('mapped');
      tallyValue(values, value, 'mapped', mapping);
      if (!targetsByOrganization.has(org)) targetsByOrganization.set(org, new Set());
      targetsByOrganization.get(org)!.add(code);
      if (report.sampleRecordIds.length < MAX_SAMPLE_IDS) report.sampleRecordIds.push(String(id));
      if (!apply) continue;
      try {
        await withTransientRetry(() => engine.update(object, { id, [codeField]: code }, { context: { ...context } }), options.retry ?? {});
        bump('written');
      } catch (err) {
        // One row's failure does not abort the rest; a re-run revisits only what is still unconverted.
        const message = (err as any)?.message ?? String(err);
        logger.warn(`[unit-code-backfill] ${object} record ${String(id)}: ${message}`);
        report.failures.push({ recordId: String(id), error: rowFailureSentence(err, object, message) });
      }
    }
  }
  if (walk.truncated) report.truncated = true;
  report.values = [...values.values()].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  report.organizations = [...organizations.values()].sort((a, b) =>
    a.organizationId === b.organizationId ? 0 : a.organizationId === null ? 1 : b.organizationId === null ? -1 : a.organizationId < b.organizationId ? -1 : 1,
  );
  return { report, targetsByOrganization };
}

function tallyValue(values: Map<string, UnitCodeBackfillValue>, value: string, disposition: UnitCodeBackfillValue['disposition'], mapping: UnitCodeMapping): void {
  const key = `${disposition}\u0000${value}`;
  const hit = values.get(key);
  if (hit) { hit.rows++; return; }
  const entry: UnitCodeBackfillValue = { value, rows: 1, disposition };
  // The unit code the mapping writes (never an error code), read here from the mapping itself.
  if (disposition === 'mapped') entry.code = mapping[value];
  values.set(key, entry);
}

/**
 * What becomes of a resting code the field does not admit (a retired unit, a
 * code of another dimension). U5 judges a resting code only when a non-blank
 * quantity is written beside it (`judgedOf`), so the row is refused at its next
 * quantity edit only where a quantity names the field. A standalone field
 * (Open item 8) has none: the code is never judged at rest, and the next write
 * of the field, which judges the value written, must carry another code.
 */
const STANDALONE_RESTING = 'the field does not admit it, so the next write of the field must carry another code';

/** What the listing says of each distinct value's rows. */
const DISPOSITION_TEXT: Record<UnitCodeBackfillValue['disposition'], (v: UnitCodeBackfillValue, refusal: string) => string> = {
  member: () => 'already a unit code (never rewritten)',
  retired: (_, refusal) => `a retired unit, left as stored (${refusal})`,
  'other-dimension': (_, refusal) => `a unit code of another dimension, left as stored (${refusal})`,
  mapped: (v) => `→ ${v.code}`,
  unmatched: () => 'no mapping entry',
};

/** Human-readable report body, shared by the CLI's dry-run and apply output. */
export function formatUnitCodeBackfillReport(report: UnitCodeBackfillReport): string[] {
  const scope = report.organizationId !== null
    ? ` in organization ${report.organizationId}`
    : report.allOrganizations ? ' in every organization' : '';
  const lines = [`Scanned ${report.scannedRecords} row(s) of ${report.object}${scope} for the unit code in ${report.field}.`];
  if (report.allOrganizations) {
    for (const org of report.organizations) {
      lines.push(`  organization ${org.organizationId ?? '(none)'}: ${org.mapped} to rewrite, ${org.unmatched} unmatched` +
        (report.applied ? `, ${org.written} written` : ''));
    }
  }
  const standalone = report.quantityFields.length === 0;
  const restingClause = standalone ? STANDALONE_RESTING : 'refused at its next quantity edit';
  for (const v of report.values) {
    const shown = v.value === '' ? '(blank, beside a quantity)' : JSON.stringify(v.value);
    lines.push(`  ${shown}: ${v.rows} row(s), ` + DISPOSITION_TEXT[v.disposition](v, restingClause));
  }
  // The rows this run leaves holding no unit code the field admits.
  const notAdmitted = report.blankBesideQuantity + report.skippedRetired + report.skippedOtherDimension;
  if (report.mapped > 0) {
    lines.push(report.applied
      ? `Wrote ${report.written} of ${report.mapped} row(s) the mapping rewrites.`
      : `Would rewrite ${report.mapped} row(s) from the mapping.`, `  e.g. ${report.sampleRecordIds.join(', ')}`);
  } else if (report.unmatched === 0) {
    lines.push(report.truncated
      ? `No ${report.object}.${report.field} value to rewrite among the ${report.scannedRecords} row(s) examined.`
      : notAdmitted === 0
        ? `✓ Every ${report.object}.${report.field} value is a unit code the field admits — nothing to convert.`
        : `Nothing to rewrite from the mapping, but ${notAdmitted} row(s) of ${report.object}.${report.field} hold no unit code ` +
          'the field admits (below).');
  }
  lines.push(`· Skipped: ${report.skippedMember} row(s) already holding a unit code (never rewritten), ` +
    `${report.skippedBlank} blank row(s) with no quantity (no unit owed).`);
  if (report.blankBesideQuantity > 0) {
    lines.push(`⚠ ${report.blankBesideQuantity} blank unit(s) beside a quantity left blank: each row is refused at its next ` +
      'quantity edit until it holds a unit code. A "" entry in the mapping writes them.');
  }
  if (report.skippedRetired > 0) {
    lines.push(`⚠ ${report.skippedRetired} row(s) rest on a retired unit, left as stored (a unit code is never rewritten): ` +
      (standalone ? `${STANDALONE_RESTING}.` : 'each is refused at its next quantity edit until the record is given a current unit.'));
  }
  if (report.skippedOtherDimension > 0) {
    lines.push(`⚠ ${report.skippedOtherDimension} row(s) hold a unit code of another dimension than the field's unitDimension, ` +
      (standalone ? `left as stored: ${STANDALONE_RESTING}.` : 'left as stored: each is refused at its next quantity edit until the record is corrected.'));
  }
  if (report.unmatched > 0) {
    lines.push(`✗ ${report.unmatched} row(s) hold a value with no mapping entry: an apply run is refused until each value is ` +
      'mapped or those rows are corrected.');
  }
  if (report.failures.length > 0) {
    lines.push(`✗ ${report.failures.length} row(s) could not be written:`);
    for (const f of report.failures.slice(0, MAX_SAMPLE_IDS)) lines.push(`  • ${f.recordId}: ${f.error}`);
    if (report.failures.length > MAX_SAMPLE_IDS) lines.push(`  … and ${report.failures.length - MAX_SAMPLE_IDS} more`);
    lines.push('Re-running is safe: a row holding a unit code is never rewritten.');
  }
  if (report.truncated) lines.push('⚠ Walk incomplete — some rows were not examined; re-run without the cap to finish.');
  if (!report.applied && report.mapped > 0) lines.push('Dry run — no row or table was written. Re-run with --apply to convert.');
  return lines;
}

/**
 * Did this run leave every row of the field holding a unit code the field
 * admits? A blank beside a quantity, a retired unit and a code of another
 * dimension are none. Beside a quantity, each is refused at the row's next
 * quantity edit. On a standalone field (no quantity) a retired unit or a code
 * of another dimension is never judged at rest, but the field does not admit
 * it, so the next write of the field must carry another code. A run leaving
 * any of them is not complete, nor is one with an unmatched value, a failed
 * row or an unexamined row.
 */
export function unitCodeBackfillComplete(report: UnitCodeBackfillReport): boolean {
  return report.failures.length === 0 && !report.truncated && report.unmatched === 0
    && report.blankBesideQuantity === 0 && report.skippedRetired === 0 && report.skippedOtherDimension === 0
    && (report.applied || report.mapped === 0);
}
