// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { emitJson, isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
// The `objectql` slot's contract (#4251) — read the registry through it rather
// than erasing the lookup to `any`, so a rename breaks this at compile time
// instead of silently reporting zero objects.
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
// TYPE-ONLY on purpose. The value side (`resolveSeedTenancyExec` and the three
// platform constants) is loaded with `await import()` inside `run()`: oclif
// `import()`s every command module on every CLI invocation, so a heavy static
// import here is charged to whatever command the operator actually ran (#5726
// makes the same point about driver packages).
import type { SeedTenancyExec } from '@objectstack/metadata-protocol';

/**
 * `os migrate duplicates` — the operator-facing inventory of business
 * identifiers the tenancy split already minted twice (#8928).
 *
 * ## What this is, and what it deliberately is not
 *
 * Two producers of untenanted rows have been closed (#8686's seed loader plus
 * its one-shot backfill, and #8844's runtime system-context write). Neither
 * touches the damage already done, and both rulings say the same thing about
 * it: **a business identifier that has already been handed out is not the
 * platform's to rewrite.** So this command produces an inventory and nothing
 * else — it never renumbers, deduplicates, moves a row between partitions or
 * writes anything at all.
 *
 * Implemented to the 2026-08-16 maintainer ruling on #8928, which settled all
 * five of the card's decision points:
 *
 *  1. **CLI door only** — this command, beside the rest of the `os migrate`
 *     family. No REST endpoint, no boot-time report.
 *  2. **The narrow definition of "duplicate"** — one object/field value held by
 *     rows in more than one of the partitions `COALESCE(organization_id,
 *     '__global__')` separates (ADR-0120 D3). Repeated values *within* one
 *     partition are not reported: the partitioned unique index bites there, so
 *     a repeat inside a partition is a different defect with a different cause.
 *  3. **JSON to stdout, no persistence** — the operator archives it. No new
 *     schema, no rows written, nothing left behind.
 *  4. **The live CONDITION is reported too** — an install still holding a
 *     `__global__` counter beside an organization-scoped one for the same
 *     object is about to mint more duplicates. The only forward-looking line in
 *     the report.
 *  5. **A data-side probe** — `GROUP BY <field> HAVING COUNT(*) > 1` within the
 *     object's own table, never an enumeration of `_objectstack_sequences`. A
 *     duplicate on an object whose counter was since merged is therefore still
 *     found, and the probe does not assume the driver keeps counters at all.
 *
 * ## Why the evidence is perishable, and what that demands of this command
 *
 * `organization_id = NULL` is the marker that says "this row came from the
 * untenanted side", and it is exactly what the #8686 backfill overwrites. The
 * ruling's binding timing note follows: this report must be runnable **before**
 * that repair is applied on an install, and must not depend on state the repair
 * destroys. Two consequences, both load-bearing:
 *
 *  - **This command applies nothing.** It boots read-only (the same
 *    `deferSchemaDdl` + `readOnlyProbe` boot `os migrate plan` uses, so no DDL,
 *    no seed and no database file are created) and issues SELECTs only.
 *    `duplicates.pre-repair.test.ts` pins that a full run leaves both the rows
 *    and `_objectstack_sequences` byte-identical, and that the repair — run
 *    afterwards, in the same test — is what makes the live condition vanish.
 *  - **The duplicate probe reads user data, not counters.** The counter table
 *    is consulted for one thing only, the live condition of point 4, which is a
 *    fact about counters and lives nowhere else. When that table is absent the
 *    duplicate inventory is still complete.
 *
 * ## Scope of the scan
 *
 * Every registered object that is organization-scoped, and on it every field
 * that is an identifier — `type: 'autonumber'`, or carrying any `unique`
 * spelling. `sys_` / `cloud_` / `ai_` objects are **not** filtered out: that
 * filter is correct for a *repair* (platform seeds stay global by design) and
 * wrong for a report, which must not silently omit a real duplicate. Anything
 * that could not be probed is listed in `skipped` with the reason — a target
 * this command could not read is never reported as a target with no findings.
 */

/** One `(object, field)` this run probed. */
export interface DuplicateScanTarget {
  object: string;
  field: string;
  /** Column the ADR-0120 D3 partition is keyed on for this object. */
  partitionField: string;
  /** Why the field is an identifier at all. */
  identifier: 'autonumber' | 'unique';
  /** The authored `unique` spelling, when the field carries one. */
  uniqueScope: 'organization' | 'global' | null;
}

/** One `(object, field)` this run could NOT probe, and why. */
export interface DuplicateSkippedTarget {
  object: string;
  field?: string;
  reason: string;
}

/** One row holding a duplicated value. */
export interface DuplicateHolder {
  /** The row's id, as stored. */
  id: string | null;
  /** The row's organization, or `null` for the untenanted side. */
  organization: string | null;
  /** The partition the row falls in — `organization` or the global sentinel. */
  partition: string;
  /** The row's `created_at`, or `null` when the object carries no such column. */
  createdAt: string | null;
}

/** One value held across more than one partition. */
export interface DuplicateIdentifier {
  object: string;
  field: string;
  /** The value, rendered as text — autonumber formats are strings anyway. */
  value: string;
  /** How many rows hold it. */
  holderCount: number;
  /** The distinct partitions it is held in, sorted. */
  partitions: string[];
  holders: DuplicateHolder[];
}

/**
 * One object/field still running two counters — the live condition (point 4).
 *
 * Not damage: a prediction. While both counters stand, each allocates within
 * its own partition and neither can see the other's numbers.
 */
export interface DuplicateLiveCondition {
  object: string;
  field: string;
  globalLastValue: number;
  organizationCounters: Array<{ organization: string; lastValue: number }>;
}

/**
 * The report — a machine-readable contract, consumed by auditors and tools.
 *
 * Shaped deliberately and pinned by `duplicates.contract.test.ts`: the fields
 * below are what a consumer may rely on, so the shape is not free to drift with
 * the implementation. `reportVersion` is what changes when it must.
 */
export interface DuplicateIdentifierReport {
  report: 'duplicate-identifiers';
  reportVersion: 1;
  /** ISO-8601, so archived reports sort and diff. */
  generatedAt: string;
  /** The database this describes, in the same words the migrate family prints. */
  database: string;
  /** The sentinel the NULL-organization partition folds into (ADR-0120 D3). */
  globalPartition: string;
  /** `null` unless `--object` narrowed the run — an archived report must not read as a full scan. */
  filter: { object: string } | null;
  /** Where the live condition was read from, and whether it could be read. */
  counters: { table: string; status: 'read' | 'absent' };
  scanned: DuplicateScanTarget[];
  skipped: DuplicateSkippedTarget[];
  duplicates: DuplicateIdentifier[];
  liveConditions: DuplicateLiveCondition[];
  summary: {
    objectsScanned: number;
    fieldsScanned: number;
    duplicateValues: number;
    duplicateRows: number;
    liveConditions: number;
  };
}

/**
 * Reject anything that is not a plain SQL identifier.
 *
 * Object and field names are interpolated into the probes, because a table name
 * cannot be a bound parameter in any supported dialect. Every VALUE is bound;
 * only identifiers are interpolated, and only after passing this. The platform's
 * naming rule is `snake_case` machine names, so a name this rejects is one the
 * platform could not have written. (Same guard, same reasoning, as the one in
 * `seed-tenancy-backfill.ts`.)
 */
function isSafeIdentifier(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Quote an identifier for the dialect actually connected.
 *
 * MySQL does not run with `ANSI_QUOTES`, so `"x"` there is a string literal and
 * not an identifier — a probe written with one quoting style for every dialect
 * cannot run on all three. The client name comes from the live driver config
 * (`sqlite3` / `better-sqlite3` / `pg` / `mysql` / `mysql2`), the same source
 * the migrate family reads to name the database.
 */
export function quoteIdent(name: string, client?: string): string {
  const c = String(client ?? '').toLowerCase();
  if (c === 'mysql' || c === 'mysql2') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** A string literal safe to inline — the platform's own sentinel, never user input. */
function quoteLiteral(value: string): string {
  if (value.includes("'")) throw new Error(`unsafe literal in duplicate probe: ${value}`);
  return `'${value}'`;
}

/** Field map or field array — both authoring shapes are accepted. */
function fieldEntriesOf(fields: unknown): Array<{ name: string; def: Record<string, unknown> }> {
  if (!fields) return [];
  if (Array.isArray(fields)) {
    return fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && (f as any).name != null)
      .map((f) => ({ name: String((f as any).name), def: f }));
  }
  if (typeof fields !== 'object') return [];
  return Object.entries(fields as Record<string, unknown>).map(([name, def]) => ({
    name,
    def: (def ?? {}) as Record<string, unknown>,
  }));
}

/**
 * The NULL-safe partition key part, ADR-0120 D3's exact form — the expression
 * the platform's own unique index is built on, restated here because it is what
 * "the same value across partitions" MEANS.
 */
export function partitionExpression(partitionField: string, globalTenant: string, client?: string): string {
  return `COALESCE(${quoteIdent(partitionField, client)}, ${quoteLiteral(globalTenant)})`;
}

/**
 * The ruled probe (point 5): group the object's own rows by the identifier
 * value and keep the values held more than once — then narrow to the ones held
 * in more than one partition, which is the ruled definition of duplicate
 * (point 2).
 *
 * Both halves are expressed in SQL rather than filtered in memory: the
 * in-partition repeats a `HAVING COUNT(*) > 1` alone would return are exactly
 * what the partitioned unique index already prevents, and on a large table they
 * are the bulk of the rows a naive probe would drag back.
 *
 * ⛔ Reads the object's table only. `_objectstack_sequences` is deliberately
 * absent: a duplicate whose counter was since merged is invisible to a
 * counter-keyed enumeration, and a driver that keeps no counters at all has the
 * same duplicates.
 */
export function buildDuplicateProbeSql(opts: {
  object: string;
  field: string;
  partitionField: string;
  globalTenant: string;
  client?: string;
}): string {
  const { object, field, partitionField, globalTenant, client } = opts;
  if (!isSafeIdentifier(object) || !isSafeIdentifier(field) || !isSafeIdentifier(partitionField)) {
    throw new Error(`unsafe identifier in duplicate probe: ${object}.${field}`);
  }
  const t = quoteIdent(object, client);
  const f = quoteIdent(field, client);
  const p = partitionExpression(partitionField, globalTenant, client);
  return (
    `SELECT ${f} AS dup_value, COUNT(*) AS holder_count, ` +
    `COUNT(DISTINCT ${p}) AS partition_count ` +
    `FROM ${t} WHERE ${f} IS NOT NULL ` +
    `GROUP BY ${f} ` +
    `HAVING COUNT(*) > 1 AND COUNT(DISTINCT ${p}) > 1 ` +
    `ORDER BY ${f}`
  );
}

/**
 * The holder rows behind one batch of duplicated values — ids, organizations
 * and creation timestamps, one row per holder, which is what makes the report
 * actionable per record rather than per value.
 *
 * `created_at` is platform-provisioned but an object may opt out of system
 * fields, so the caller retries without it; `withCreatedAt: false` is that
 * second attempt, and the holders it produces carry `createdAt: null`.
 */
export function buildHolderProbeSql(opts: {
  object: string;
  field: string;
  partitionField: string;
  valueCount: number;
  withCreatedAt: boolean;
  client?: string;
}): string {
  const { object, field, partitionField, valueCount, withCreatedAt, client } = opts;
  if (!isSafeIdentifier(object) || !isSafeIdentifier(field) || !isSafeIdentifier(partitionField)) {
    throw new Error(`unsafe identifier in holder probe: ${object}.${field}`);
  }
  if (!Number.isInteger(valueCount) || valueCount < 1) {
    throw new Error(`holder probe needs at least one value: ${object}.${field}`);
  }
  const t = quoteIdent(object, client);
  const f = quoteIdent(field, client);
  const p = quoteIdent(partitionField, client);
  const placeholders = Array.from({ length: valueCount }, () => '?').join(', ');
  const created = withCreatedAt ? `, ${quoteIdent('created_at', client)} AS created_at` : '';
  return (
    `SELECT ${quoteIdent('id', client)} AS holder_id, ${f} AS dup_value, ${p} AS organization${created} ` +
    `FROM ${t} WHERE ${f} IN (${placeholders}) ` +
    `ORDER BY ${f}, ${quoteIdent('id', client)}`
  );
}

/**
 * The live condition (point 4): every object/field whose `__global__` counter
 * is still standing BESIDE an organization-scoped one.
 *
 * An INNER JOIN, deliberately — "beside" is the whole claim. (The backfill's own
 * probe is a LEFT JOIN because it triggers a *repair*, which must also fire on a
 * fresh install where the organization-scoped counter does not exist yet. This
 * is a different question with a different answer.)
 *
 * This is the one probe that reads the driver-private counter table, because
 * this is the one fact that lives nowhere else. Point 5's "not keyed on
 * `_objectstack_sequences`" governs the duplicate inventory above, which is
 * about rows.
 */
export function buildLiveConditionProbeSql(sequencesTable: string, client?: string): string {
  if (!isSafeIdentifier(sequencesTable)) {
    throw new Error(`unsafe identifier in live-condition probe: ${sequencesTable}`);
  }
  const t = quoteIdent(sequencesTable, client);
  return (
    `SELECT g.object AS object, g.field AS field, g.last_value AS global_last_value, ` +
    `o.tenant_id AS organization, o.last_value AS organization_last_value ` +
    `FROM ${t} g JOIN ${t} o ON g.object = o.object AND g.field = o.field AND o.tenant_id <> ? ` +
    `WHERE g.tenant_id = ? ` +
    `ORDER BY g.object, g.field, o.tenant_id`
  );
}

/** Probe statement: does the counter table exist at all? */
export function buildSequencesPresenceProbeSql(sequencesTable: string, client?: string): string {
  if (!isSafeIdentifier(sequencesTable)) {
    throw new Error(`unsafe identifier in presence probe: ${sequencesTable}`);
  }
  return `SELECT tenant_id FROM ${quoteIdent(sequencesTable, client)} WHERE 1 = 0`;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Which `(object, field)` pairs are in the population at all.
 *
 * An identifier field is one the platform mints or constrains — `autonumber`,
 * or any `unique` spelling. An object with none is not a candidate and is not
 * listed; an object that HAS them but is not organization-scoped is listed in
 * `skipped`, because a reader would otherwise be left wondering.
 */
export function collectScanTargets(
  objects: unknown[],
  opts: { organizationField: string; objectFilter?: string },
): { targets: DuplicateScanTarget[]; skipped: DuplicateSkippedTarget[] } {
  const targets: DuplicateScanTarget[] = [];
  const skipped: DuplicateSkippedTarget[] = [];

  for (const obj of Array.isArray(objects) ? (objects as Array<Record<string, unknown>>) : []) {
    const objectName = typeof obj?.name === 'string' ? obj.name.trim() : '';
    if (!objectName) continue;
    if (opts.objectFilter && objectName !== opts.objectFilter) continue;

    const entries = fieldEntriesOf(obj?.fields);
    const identifiers = entries.filter(({ def }) => {
      const unique = def?.unique;
      return def?.type === 'autonumber' || unique === true || unique === 'organization' || unique === 'global';
    });
    if (identifiers.length === 0) continue;

    if (!isSafeIdentifier(objectName)) {
      skipped.push({ object: objectName, reason: 'object name is not a plain SQL identifier' });
      continue;
    }

    // `tenancy.enabled === false` opts the object out of row-level organization
    // scoping (ADR-0066), so its uniqueness is NOT partitioned and a value
    // repeated across organizations is refused by a plain index rather than
    // hidden by a partitioned one. Out of the ruled population — and said out
    // loud, not dropped.
    const tenancy = obj?.tenancy as { enabled?: boolean; tenantField?: string } | undefined;
    if (tenancy?.enabled === false) {
      skipped.push({
        object: objectName,
        reason: 'object declares tenancy.enabled = false — its uniqueness is not organization-partitioned',
      });
      continue;
    }

    // Mirrors the driver's own `computeTenantField`: a declared name is honoured
    // only when the object really has that field, otherwise the platform column.
    const declared = tenancy?.tenantField;
    const partitionField =
      declared && entries.some(({ name }) => name === declared) ? declared : opts.organizationField;
    if (!isSafeIdentifier(partitionField)) {
      skipped.push({
        object: objectName,
        reason: `tenancy.tenantField '${String(declared)}' is not a plain SQL identifier`,
      });
      continue;
    }

    for (const { name, def } of identifiers) {
      if (!isSafeIdentifier(name)) {
        skipped.push({ object: objectName, field: name, reason: 'field name is not a plain SQL identifier' });
        continue;
      }
      const unique = def?.unique;
      targets.push({
        object: objectName,
        field: name,
        partitionField,
        identifier: def?.type === 'autonumber' ? 'autonumber' : 'unique',
        uniqueScope: unique === 'global' ? 'global' : unique ? 'organization' : null,
      });
    }
  }

  targets.sort((a, b) => a.object.localeCompare(b.object) || a.field.localeCompare(b.field));
  skipped.sort(
    (a, b) => a.object.localeCompare(b.object) || String(a.field ?? '').localeCompare(String(b.field ?? '')),
  );
  return { targets, skipped };
}

/** How many values one holder query asks about — bound-parameter limits are per dialect. */
const HOLDER_BATCH = 200;

export interface CollectDuplicateReportOptions {
  exec: SeedTenancyExec;
  /** Flattens the three dialect result shapes — `normalizeRows` from metadata-protocol. */
  normalize: (result: unknown) => Array<Record<string, unknown>>;
  /** Every object the booted stack knows about. */
  objects: unknown[];
  database: string;
  globalTenant: string;
  organizationField: string;
  sequencesTable: string;
  client?: string;
  objectFilter?: string;
  /** Injected so the contract test can pin a stable document. */
  now?: () => Date;
}

/**
 * Run every probe and assemble the report.
 *
 * Read-only from end to end: SELECTs, no transaction, nothing written. A probe
 * that throws produces a `skipped` entry naming the driver's own message and
 * never aborts the run — a report that stopped at the first unreadable object
 * would be a report the operator cannot trust to be complete.
 */
export async function collectDuplicateIdentifierReport(
  opts: CollectDuplicateReportOptions,
): Promise<DuplicateIdentifierReport> {
  const { exec, normalize, globalTenant, organizationField, sequencesTable, client } = opts;
  const { targets, skipped } = collectScanTargets(opts.objects, {
    organizationField,
    ...(opts.objectFilter ? { objectFilter: opts.objectFilter } : {}),
  });

  const duplicates: DuplicateIdentifier[] = [];

  for (const target of targets) {
    let values: Array<{ value: string; holderCount: number }>;
    try {
      const rows = normalize(
        await exec(
          buildDuplicateProbeSql({
            object: target.object,
            field: target.field,
            partitionField: target.partitionField,
            globalTenant,
            ...(client ? { client } : {}),
          }),
        ),
      );
      values = rows
        .filter((r) => r.dup_value != null)
        .map((r) => ({ value: String(r.dup_value), holderCount: toNumber(r.holder_count) }));
    } catch (error) {
      skipped.push({
        object: target.object,
        field: target.field,
        reason: `duplicate probe failed: ${messageOf(error)}`,
      });
      continue;
    }
    if (values.length === 0) continue;

    const holdersByValue = new Map<string, DuplicateHolder[]>();
    let holderReadFailed: string | undefined;
    for (let i = 0; i < values.length; i += HOLDER_BATCH) {
      const batch = values.slice(i, i + HOLDER_BATCH).map((v) => v.value);
      let rows: Array<Record<string, unknown>> | undefined;
      for (const withCreatedAt of [true, false]) {
        try {
          rows = normalize(
            await exec(
              buildHolderProbeSql({
                object: target.object,
                field: target.field,
                partitionField: target.partitionField,
                valueCount: batch.length,
                withCreatedAt,
                ...(client ? { client } : {}),
              }),
              batch,
            ),
          );
          break;
        } catch (error) {
          holderReadFailed = messageOf(error);
        }
      }
      if (!rows) break;
      holderReadFailed = undefined;
      for (const row of rows) {
        if (row.dup_value == null) continue;
        const organization = row.organization == null ? null : String(row.organization);
        const holder: DuplicateHolder = {
          id: row.holder_id == null ? null : String(row.holder_id),
          organization,
          partition: organization ?? globalTenant,
          createdAt: row.created_at == null ? null : String(row.created_at),
        };
        const key = String(row.dup_value);
        const list = holdersByValue.get(key);
        if (list) list.push(holder);
        else holdersByValue.set(key, [holder]);
      }
    }
    if (holderReadFailed) {
      // The value IS a duplicate — that much was measured — but this run cannot
      // say which rows hold it. Reported as a finding with no holders AND as a
      // skip, never as a clean read.
      skipped.push({
        object: target.object,
        field: target.field,
        reason: `holder rows unreadable: ${holderReadFailed}`,
      });
    }

    for (const { value, holderCount } of values) {
      const holders = (holdersByValue.get(value) ?? []).sort(
        (a, b) => a.partition.localeCompare(b.partition) || String(a.id).localeCompare(String(b.id)),
      );
      duplicates.push({
        object: target.object,
        field: target.field,
        value,
        holderCount,
        partitions: [...new Set(holders.map((h) => h.partition))].sort(),
        holders,
      });
    }
  }

  duplicates.sort(
    (a, b) =>
      a.object.localeCompare(b.object) || a.field.localeCompare(b.field) || a.value.localeCompare(b.value),
  );

  // ── The live condition (point 4) ────────────────────────────────────
  let counterStatus: 'read' | 'absent' = 'read';
  const liveConditions: DuplicateLiveCondition[] = [];
  try {
    await exec(buildSequencesPresenceProbeSql(sequencesTable, client));
  } catch {
    counterStatus = 'absent';
  }
  if (counterStatus === 'read') {
    try {
      const rows = normalize(
        await exec(buildLiveConditionProbeSql(sequencesTable, client), [globalTenant, globalTenant]),
      );
      const byKey = new Map<string, DuplicateLiveCondition>();
      for (const row of rows) {
        const object = row.object == null ? '' : String(row.object);
        const field = row.field == null ? '' : String(row.field);
        const organization = row.organization == null ? '' : String(row.organization);
        if (!object || !field || !organization) continue;
        const key = `${object}.${field}`;
        const entry = byKey.get(key) ?? {
          object,
          field,
          globalLastValue: toNumber(row.global_last_value),
          organizationCounters: [],
        };
        entry.organizationCounters.push({
          organization,
          lastValue: toNumber(row.organization_last_value),
        });
        byKey.set(key, entry);
      }
      liveConditions.push(...byKey.values());
      liveConditions.sort((a, b) => a.object.localeCompare(b.object) || a.field.localeCompare(b.field));
    } catch (error) {
      counterStatus = 'absent';
      skipped.push({ object: sequencesTable, reason: `live-condition probe failed: ${messageOf(error)}` });
    }
  }

  const objectsScanned = new Set(targets.map((t) => t.object)).size;
  return {
    report: 'duplicate-identifiers',
    reportVersion: 1,
    generatedAt: (opts.now?.() ?? new Date()).toISOString(),
    database: opts.database,
    globalPartition: globalTenant,
    filter: opts.objectFilter ? { object: opts.objectFilter } : null,
    counters: { table: sequencesTable, status: counterStatus },
    scanned: targets,
    skipped,
    duplicates,
    liveConditions,
    summary: {
      objectsScanned,
      fieldsScanned: targets.length,
      duplicateValues: duplicates.length,
      duplicateRows: duplicates.reduce((total, d) => total + d.holderCount, 0),
      liveConditions: liveConditions.length,
    },
  };
}

export default class MigrateDuplicates extends Command {
  static override description =
    'Report business identifiers already minted twice across the organization partitions (#8928). ' +
    'Read-only inventory as JSON on stdout — never renumbers, deduplicates or rewrites anything. ' +
    'Run it BEFORE the #8686 tenancy backfill: the repair overwrites the evidence.';

  static override examples = [
    '$ os migrate duplicates',
    '$ os migrate duplicates > duplicates-2026-08-17.json',
    '$ os migrate duplicates --object crm_case',
    '$ os migrate duplicates --database-url postgres://…',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to inspect (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    object: Flags.string({
      description: 'Restrict the scan to one object (recorded in the report, so a narrowed run cannot be mistaken for a full one)',
    }),
  };

  /**
   * Output is ALWAYS the JSON document — there is no `--json` flag and no human
   * renderer, per the ruling's point 3: the report IS the deliverable, the
   * operator archives it, and a second renderer would be a second contract to
   * keep true. stdout is therefore reserved for the payload for the whole run
   * (`jsonOutput: true`), so the boot's own log lines go to stderr (#6217).
   */
  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateDuplicates);

    let stack;
    try {
      // Read-only boot: `deferSchemaDdl` holds back create-table/add-column DDL
      // and suppresses the artifact seed, `readOnlyProbe` refuses to bring a
      // missing sqlite file into existence. Between them this command cannot
      // change the install it is describing.
      stack = await bootSchemaStack({
        jsonOutput: true,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        deferSchemaDdl: true,
        readOnlyProbe: true,
      });
    } catch (error: unknown) {
      await emitJson({ error: 'boot_failed', detail: messageOf(error) }, 1, { compact: true });
      return;
    }

    try {
      const {
        resolveSeedTenancyExec,
        normalizeRows,
        GLOBAL_TENANT,
        ORGANIZATION_FIELD,
        SEQUENCES_TABLE,
      } = await import('@objectstack/metadata-protocol');

      const getService = (stack.kernel as { getService?: (name: string) => unknown })?.getService;
      const ql = getService?.call(stack.kernel, 'objectql') as IObjectQLEngine | undefined;
      const exec = resolveSeedTenancyExec(ql);
      if (!exec) {
        // Loud absence, never a clean empty report: a driver with no raw-SQL
        // seam (memory, mongodb) cannot be grouped by value from here, and
        // "zero duplicates" would be indistinguishable from "never looked".
        await emitJson(
          {
            error: 'no_sql_seam',
            detail:
              'The active driver exposes no raw SQL seam, so the data-side duplicate probe cannot run. ' +
              'This report supports the SQL drivers (sqlite / postgres / mysql / turso).',
          },
          1,
          { compact: true },
        );
        return;
      }

      const report = await collectDuplicateIdentifierReport({
        exec,
        normalize: normalizeRows,
        objects: stack.allObjects(),
        database: stack.dbLabel,
        globalTenant: GLOBAL_TENANT,
        organizationField: ORGANIZATION_FIELD,
        sequencesTable: SEQUENCES_TABLE,
        ...(((stack.driver?.config as { client?: unknown } | undefined)?.client)
          ? { client: String((stack.driver?.config as { client?: unknown }).client) }
          : {}),
        ...(flags.object ? { objectFilter: flags.object } : {}),
      });

      await emitJson(report);
    } catch (error: unknown) {
      if (isExitSignal(error)) throw error;
      await emitJson({ error: 'report_failed', detail: messageOf(error) }, 1, { compact: true });
    } finally {
      await stack.shutdown();
    }
  }
}
