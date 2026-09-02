// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13999] `os migrate duplicates` reports ONE `createdAt` spelling, on every dialect.
 *
 * ## The defect, and why every existing pin was green through it
 *
 * `DuplicateHolder.createdAt` is declared `string | null`, and the mapper built
 * it with `String(row.created_at)`. `created_at` is a BUILTIN audit column — not
 * in `datetimeFields`, and `SqlDriver#formatOutput` repairs it only inside its
 * `if (this.isSqlite)` arm — and the holder probe reads through the raw-SQL seam,
 * so no presentation runs on this path at all. The dialect therefore decides what
 * arrives:
 *
 *  - **Postgres / MySQL** materialise a JS `Date`, so `String()` ran
 *    `Date.prototype.toString`: `Sun Aug 30 2026 18:19:25 GMT+0800 (China
 *    Standard Time)` — the operator's local zone baked in, whole seconds instead
 *    of milliseconds, no `Z`, and not `Date.parse`-safe for anything consuming
 *    this command's JSON.
 *  - **SQLite** and its siblings hand back canonical ISO-8601 UTC text, which
 *    `String()` passes through untouched.
 *
 * Every pin this command already has drives SQLite (`duplicates.contract.test.ts`
 * asserts the holder document against a real better-sqlite3 fixture), which is
 * exactly the side that was already correct. That is why this file exists and why
 * its whole point is to DISTINGUISH the two dialects rather than re-assert one:
 * a test exercising only SQLite proves nothing about the defect.
 *
 * ## Which half rests on which evidence
 *
 * §A2 is a real dialect measurement — a live better-sqlite3 database, the real
 * probes, the real collector. §A1 is the other side, and no runner here hosts a
 * Postgres or a MySQL, so it drives the materialisation those dialects produce
 * through a hand-built seam double. That `Date` is not this file's claim to make:
 * it is the fact pinned, against live servers, in
 * `packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`
 * (read for this card, deliberately neither duplicated nor edited here — and the
 * layering runs the same way `@objectstack/metadata-protocol`'s own OCC suite is
 * argued: the consumer's seam is measured with the producer's measured value).
 *
 * §A3 is the assertion that actually states the contract — the two legs agree —
 * and §A4 keeps the whole file non-vacuous by measuring what the removed
 * expression really produced.
 *
 * ⛔ Not a `??` fallback and not a driver change: `withPostgresCalendarDayAsText`
 * is a deliberate driver decision and is untouched. The CLI is a leaf consumer
 * with a declared `string | null`, so the canonical spelling is owed here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  normalizeRows,
  GLOBAL_TENANT,
  ORGANIZATION_FIELD,
  SEQUENCES_TABLE,
  type SeedTenancyExec,
} from '@objectstack/metadata-protocol';
import {
  canonicalHolderCreatedAt,
  collectDuplicateIdentifierReport,
  type DuplicateHolder,
} from './duplicates.js';

/** The instant from the #13567 production report, kept verbatim. */
const GLOBAL_INSTANT = '2026-08-30T10:19:25.947Z';
/** A second instant, so the mapper is measured per row rather than against a constant. */
const ORG_INSTANT = '2026-02-01T00:00:00.001Z';

/**
 * The zone the incident was observed in, FORCED rather than required.
 *
 * Test Core runs at UTC and `Temporal Conformance` at `America/New_York`, so the
 * operator-facing symptom in §A4 would otherwise be spelled differently on every
 * runner. Forcing it also makes §A1 mean what it says: the canonical spelling it
 * asserts is produced while the process is demonstrably NOT at UTC.
 */
const INCIDENT_ZONE = 'Asia/Shanghai';

/**
 * Run `body` with the process pinned to `tz`, then restore.
 *
 * Restoring rather than assuming matters because vitest reuses a worker across
 * files — a leaked `TZ` would silently re-zone whatever runs next in this
 * process. (A sibling copy lives in the driver-sql pin above; a zone-scoping
 * utility is not a guard that could weaken in one copy and nowhere else, so the
 * two are deliberately independent rather than shared across a package boundary.)
 */
async function underProcessZone<T>(tz: string, body: () => Promise<T> | T): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** The registry view the booted stack hands the command. */
const CASE_ONLY = [{ name: 'crm_case', fields: { case_number: { type: 'autonumber' } } }];
const CASE_AND_TICKET = [
  ...CASE_ONLY,
  // No `created_at`: an object that opted out of system fields still has to
  // produce holders, with a null timestamp rather than a failed probe.
  { name: 'crm_ticket', fields: { ticket_number: { type: 'autonumber' } } },
];

const collect = (exec: SeedTenancyExec, objects: unknown[]) =>
  collectDuplicateIdentifierReport({
    exec,
    normalize: normalizeRows,
    objects,
    database: 'fixture',
    globalTenant: GLOBAL_TENANT,
    organizationField: ORGANIZATION_FIELD,
    sequencesTable: SEQUENCES_TABLE,
    client: 'better-sqlite3',
    now: () => new Date(GLOBAL_INSTANT),
    // This file measures the holder mapper and nothing else; the pre-flight
    // section has its own pins over its own fixtures in the contract test.
    runtimeIndexPreflight: [],
  });

const holdersOf = (duplicates: Array<{ holders: DuplicateHolder[] }>): DuplicateHolder[] =>
  duplicates.flatMap((d) => d.holders);

// ── §A1's seam: the value the live dialects put on the wire ─────────────────

/**
 * A raw-SQL seam that answers the holder probe with `created_at` materialised the
 * way Postgres and MySQL materialise it — a JS `Date`.
 *
 * Dispatches on the probes' own aliases: `AS holder_id` is unique to the holder
 * statement, `AS dup_value` is then the duplicate statement, and the counter
 * table simply does not exist in this fixture (a `__global__` counter beside an
 * organization-scoped one is #8928's live CONDITION, a different section of the
 * report and not this card's).
 */
function liveDialectSeam(globalStamp: unknown, orgStamp: unknown): SeedTenancyExec {
  return async (sql: string) => {
    if (sql.includes('AS holder_id')) {
      return [
        { holder_id: 's1', dup_value: 'CASE-00001', organization: null, created_at: globalStamp },
        { holder_id: 'a1', dup_value: 'CASE-00001', organization: 'org_x', created_at: orgStamp },
      ];
    }
    if (sql.includes('AS dup_value')) {
      return [{ dup_value: 'CASE-00001', holder_count: 2, partition_count: 2 }];
    }
    throw new Error(`no such table: ${SEQUENCES_TABLE}`);
  };
}

// ── §A2's fixture: a real SQLite database, the real probes ──────────────────

let dir: string;
let driver: SqlDriver;
let sqliteExec: SeedTenancyExec;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-13999-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data', 'app.db') },
    useNullAsDefault: true,
  });
  // The same wrapper `resolveSeedTenancyExec` builds around a driver exposing
  // `execute(sql, params)`.
  sqliteExec = (sql: string, params?: unknown[]) => driver.execute(sql, (params ?? []) as any[]);
  const k = (driver as any).knex;

  await k.schema.createTable('crm_case', (t: any) => {
    t.string('id').primary();
    t.timestamp('created_at');
    t.string('organization_id');
    t.string('case_number');
  });
  await k('crm_case').insert([
    { id: 's1', created_at: GLOBAL_INSTANT, organization_id: null, case_number: 'CASE-00001' },
    { id: 'a1', created_at: ORG_INSTANT, organization_id: 'org_x', case_number: 'CASE-00001' },
  ]);

  await k.schema.createTable('crm_ticket', (t: any) => {
    t.string('id').primary();
    t.string('organization_id');
    t.string('ticket_number');
  });
  await k('crm_ticket').insert([
    { id: 't1', organization_id: null, ticket_number: 'TKT-1' },
    { id: 't2', organization_id: 'org_x', ticket_number: 'TKT-1' },
  ]);
});

afterAll(async () => {
  try { await driver.disconnect(); } catch { /* already down */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#13999 §A — one instant, two dialect materialisations, one reported spelling', () => {
  it('§A1 Postgres/MySQL hand a JS `Date`; the report carries canonical ISO-Z', async () => {
    const produced = await underProcessZone(INCIDENT_ZONE, () =>
      collect(liveDialectSeam(new Date(GLOBAL_INSTANT), new Date(ORG_INSTANT)), CASE_ONLY),
    );
    expect(holdersOf(produced.duplicates)).toEqual([
      { id: 's1', organization: null, partition: GLOBAL_TENANT, createdAt: GLOBAL_INSTANT },
      { id: 'a1', organization: 'org_x', partition: 'org_x', createdAt: ORG_INSTANT },
    ]);
  });

  it('§A2 SQLite hands canonical ISO-Z text; a real database, unchanged through the mapper', async () => {
    const produced = await underProcessZone(INCIDENT_ZONE, () => collect(sqliteExec, CASE_ONLY));
    expect(holdersOf(produced.duplicates)).toEqual([
      { id: 's1', organization: null, partition: GLOBAL_TENANT, createdAt: GLOBAL_INSTANT },
      { id: 'a1', organization: 'org_x', partition: 'org_x', createdAt: ORG_INSTANT },
    ]);
  });

  it('§A3 the two dialects agree — the operator reads one document, not two', async () => {
    const live = await collect(liveDialectSeam(new Date(GLOBAL_INSTANT), new Date(ORG_INSTANT)), CASE_ONLY);
    const sqlite = await collect(sqliteExec, CASE_ONLY);
    expect(holdersOf(live.duplicates)).toEqual(holdersOf(sqlite.duplicates));
    // And what they agree ON is machine-readable, which is the point of the
    // command's JSON: every spelling re-parses to the instant it came from.
    for (const holder of holdersOf(live.duplicates)) {
      expect(new Date(holder.createdAt as string).toISOString()).toBe(holder.createdAt);
    }
  });

  it('§A4 non-vacuity: `String(row.created_at)` really did produce a different document', async () => {
    // What the removed expression shipped on the production default driver.
    const spelled = await underProcessZone(INCIDENT_ZONE, () => String(new Date(GLOBAL_INSTANT)));
    expect(spelled.startsWith('Sun Aug 30 2026 18:19:25 GMT+0800')).toBe(true);
    expect(spelled).not.toBe(GLOBAL_INSTANT);
    // Whole seconds: the milliseconds are not merely re-spelled, they are gone,
    // so this was lossy and not only unsightly.
    expect(new Date(spelled).toISOString()).toBe('2026-08-30T10:19:25.000Z');
    // And the SQLite side of the same run was already canonical — which is how
    // the split survived: one dialect's output was never wrong.
    expect(String(GLOBAL_INSTANT)).toBe(GLOBAL_INSTANT);
  });
});

describe('#13999 §B — the arms that were not broken', () => {
  it('§B1 an object with no `created_at` column still reports holders, with `createdAt: null`', async () => {
    const produced = await collect(sqliteExec, CASE_AND_TICKET);
    const tickets = produced.duplicates.filter((d) => d.object === 'crm_ticket');
    expect(tickets).toHaveLength(1);
    expect(tickets[0].holders.map((h) => h.createdAt)).toEqual([null, null]);
    // Through the real retry, not a shortcut: the `withCreatedAt: true` probe
    // fails on this table and the collector re-asks without the column.
    expect(produced.skipped.some((s) => s.object === 'crm_ticket')).toBe(false);
  });

  it('§B2 a `Date` carrying no time value keeps its verbatim rendering instead of throwing', () => {
    // `mysql2` hands one back for a zero date, and `toISOString()` throws on it.
    // A non-instant has no canonical spelling; a spelling defect in a report must
    // not become a crashed migration command.
    const invalid = new Date(Number.NaN);
    expect(() => invalid.toISOString()).toThrow(RangeError);
    expect(canonicalHolderCreatedAt(invalid)).toBe(String(invalid));
    expect(canonicalHolderCreatedAt(null)).toBeNull();
    expect(canonicalHolderCreatedAt(undefined)).toBeNull();
  });
});
