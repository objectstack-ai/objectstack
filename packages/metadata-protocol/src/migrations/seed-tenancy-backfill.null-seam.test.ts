// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10789 — `backfillSeedTenancy` reported `no-split` over a driver it never
 * queried, and its own `absent` branch was unreachable on a no-op seam.
 *
 * ## The defect
 *
 * `InMemoryDriver.execute()` (`driver-memory/src/memory-driver.ts`) logs
 * `Raw execution not supported in InMemory driver` and returns `null`. It
 * neither throws nor is absent, so:
 *
 *   1. `resolveSeedTenancySeam`'s `canRun` — `typeof d.execute === 'function'`,
 *      a question about the driver's SHAPE — is satisfied, and
 *      `if (!seam?.exec) return { status: 'no-driver' }` never fires;
 *   2. step 1's counter-table presence probe RETURNS instead of throwing, so its
 *      `catch { return { status: 'absent' } }` never runs — even though the
 *      branch's own comment says *"Absent on a memory engine"*, which makes this
 *      a provably broken intent rather than a design choice;
 *   3. `normalizeRows(null)` is `[]`, so step 2 sees zero rows and the migration
 *      answers `no-split` — *"I looked, there is no split"* — having looked at
 *      nothing.
 *
 * ⭐ The distinction being lost, and the whole of what this file pins: **a seam
 * that cannot ANSWER is absent, not empty.** `null` is a fourth thing beside the
 * three dialect result-set shapes `normalizeRows` flattens — it means "I did not
 * run your query", and it was mapped onto "your query returned no rows".
 *
 * Same class, same consumer-side shape, as #10677 / PR #10788 landed for
 * `os migrate duplicates`: judge the seam by whether it returns a RESULT SET,
 * not by whether `execute` exists. No driver is named by the implementation.
 *
 * ## Why the real driver is not booted here, and where it IS pinned
 *
 * `@objectstack/driver-memory` is deliberately NOT imported. Every module
 * binding of that specifier is gated by `pnpm check:driver-memory-census`
 * against `scripts/driver-memory-census.ledger.json`, whose own header rules
 * that an unledgered arrival is "NOT a bookkeeping chore to silence" — it needs
 * a disposition through #5704 Q2 / #6664 A-B-C first. The ledger is shrink-only.
 *
 * Nothing is lost by that. The `execute() -> null` shape is already pinned on a
 * REAL booted memory driver by
 * `packages/cli/src/commands/migrate/duplicates.null-seam.test.ts` (#10677),
 * which asserts both halves on the live driver: the resolver still hands back a
 * seam, and that seam resolves to `null`. This file pins what THAT one cannot —
 * what `backfillSeedTenancy` does with such a seam — and the real-SQL-driver
 * half (a seam that answers, over a real `_objectstack_sequences`) is pinned in
 * `packages/runtime/src/seed-tenancy-autonumber-split.integration.test.ts`.
 *
 * ## The two-sided bar
 *
 * A change that answered `absent` whenever it was unsure would satisfy the first
 * half of this file perfectly and destroy the status's value. So both readings
 * are pinned here, and they falsify in opposite directions:
 *
 *   - the `absent`-on-a-non-answering-seam cases are a DEFECT CONTROL — they are
 *     red on the pre-fix tree, where the migration answers `no-split`;
 *   - the `no-split`-on-a-real-seam cases are PRESERVED BEHAVIOUR — green before
 *     and after, and falsified by mutating the fix (make the non-answer
 *     detection over-trigger, e.g. treat an empty array as a non-answer, and
 *     they go red while the defect control stays green).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  backfillSeedTenancy,
  isResultSet,
  normalizeRows,
  resolveSeedTenancySeam,
  GLOBAL_TENANT,
  ORGANIZATION_TABLE,
} from './seed-tenancy-backfill.js';
import type { SeedTenancyExec } from './seed-tenancy-backfill.js';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * The measured no-op seam: accepts every statement, answers none of them.
 *
 * Spelled as the driver spells it — `async () => null` — rather than as a
 * rejection, because a seam that THROWS is a different case and is deliberately
 * left alone below.
 */
const nonAnsweringSeam: SeedTenancyExec = async () => null;

/**
 * A seam that ANSWERS every probe, with an empty result set in one dialect's
 * spelling. A real install with nothing to repair looks exactly like this: the
 * counter table exists, and no object holds counters on both sides of a split.
 */
function answeringEmptySeam(spelling: 'sqlite' | 'pg' | 'mysql'): SeedTenancyExec {
  const empty = { sqlite: [], pg: { rows: [], rowCount: 0 }, mysql: [[], []] }[spelling];
  return async () => empty;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The separation itself, on values
// ───────────────────────────────────────────────────────────────────────────

describe('#10789 isResultSet — "answered nothing" is not "answered no rows"', () => {
  it('accepts every dialect result-set shape, INCLUDING the empty spellings', () => {
    // better-sqlite3 through knex: a bare row array.
    expect(isResultSet([{ object: 'crm_case' }])).toBe(true);
    expect(isResultSet([])).toBe(true);
    // pg: `{ rows, rowCount, … }`.
    expect(isResultSet({ rows: [{ object: 'crm_case' }], rowCount: 1 })).toBe(true);
    expect(isResultSet({ rows: [], rowCount: 0 })).toBe(true);
    // mysql2: the `[rows, fields]` tuple.
    expect(isResultSet([[{ object: 'crm_case' }], []])).toBe(true);
    expect(isResultSet([[], []])).toBe(true);
  });

  it('rejects the fourth thing a seam can hand back — no result set at all', () => {
    // The measured shape: `InMemoryDriver.execute()` returns exactly this.
    expect(isResultSet(null)).toBe(false);
    expect(isResultSet(undefined)).toBe(false);
    // A host that echoes the statement back rather than running it.
    expect(isResultSet('SELECT 1')).toBe(false);
    expect(isResultSet({})).toBe(false);
    expect(isResultSet({ rows: 'not-an-array' })).toBe(false);
  });

  it('rejects only shapes normalizeRows already flattens to [] — no row can be lost', () => {
    // The safety argument for the whole change, asserted rather than claimed:
    // every shape newly treated as "unreadable" is one that already produced
    // zero rows, so no split this migration used to find can stop being found.
    for (const shape of [null, undefined, 'SELECT 1', {}, { rows: 'not-an-array' }, 42]) {
      expect(isResultSet(shape)).toBe(false);
      expect(normalizeRows(shape)).toEqual([]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. DEFECT CONTROL — `absent` on a seam that cannot answer
//    (red pre-fix: the migration answers `no-split`)
// ───────────────────────────────────────────────────────────────────────────

describe('#10789 a seam that returns no result set is ABSENT, not empty', () => {
  it('[defect control] a no-op seam reports absent — never no-split', async () => {
    const log = createLogger();
    const result = await backfillSeedTenancy(
      { exec: nonAnsweringSeam, client: 'better-sqlite3' },
      log as any,
    );

    // Pre-fix this is `no-split` — "I looked, there is no split" — from a probe
    // that never ran. That is the observable defect, and this line is the pin.
    expect(result.status).toBe('absent');
    expect(result.status).not.toBe('no-split');
    // `absent` already covers "could not read the counter table" (a THROWING
    // seam has always landed here). `detail` is what separates the two reasons
    // for an operator reading the result.
    expect(result.detail).toMatch(/no result set/);
    expect(result).toMatchObject({ splits: [], collisions: [], objectsStamped: 0 });
  });

  it('[defect control] the resolver still says yes — which is why absent was unreachable', async () => {
    // Unchanged on purpose. `canRun` asks whether the driver has the SHAPE of a
    // seam, a no-op `execute` has that shape, and this is the half that made
    // `no-driver` miss. The fix is downstream of here, not in the resolver: a
    // resolver that rejected a callable would have to CALL it to know, which is
    // a probe, not a shape test.
    const seam = resolveSeedTenancySeam({ driver: { execute: async () => null } });
    expect(seam?.exec).toBeTypeOf('function');
    await expect(seam!.exec('SELECT 1')).resolves.toBeNull();
  });

  it('[defect control] a seam answering the presence probe but not the split probe is absent too', async () => {
    // The residual class: a seam that answers one statement and not the next.
    // Pre-fix this is also `no-split`, for the same reason and one probe later.
    const result = await backfillSeedTenancy(
      {
        exec: async (sql: string) => (sql.includes('WHERE 1 = 0') ? [] : null),
        client: 'better-sqlite3',
      },
      createLogger() as any,
    );

    expect(result.status).toBe('absent');
    expect(result.detail).toMatch(/no result set/);
  });

  it('[defect control] a healthy install and an unreadable one are no longer the same answer', async () => {
    // The two runs differ ONLY in whether the seam answers. Before the fix both
    // returned `no-split`, which is what made the status unusable for telling
    // "nothing to repair" from "could not look".
    const unreadable = await backfillSeedTenancy(
      { exec: nonAnsweringSeam, client: 'better-sqlite3' },
      createLogger() as any,
    );
    const healthy = await backfillSeedTenancy(
      { exec: answeringEmptySeam('sqlite'), client: 'better-sqlite3' },
      createLogger() as any,
    );

    expect(unreadable.status).toBe('absent');
    expect(healthy.status).toBe('no-split');
    expect(unreadable.status).not.toBe(healthy.status);
  });

  it('[defect control] an unreadable seam stays SILENT — it is not a new boot-time warning', async () => {
    // Blast radius: this migration runs at boot on every install. The status is
    // the only thing that moves; a memory-driver boot logs exactly what it
    // logged before, which is nothing from this module.
    const log = createLogger();
    await backfillSeedTenancy({ exec: nonAnsweringSeam, client: 'better-sqlite3' }, log as any);

    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. PRESERVED BEHAVIOUR — `no-split` on a real seam with no split rows
//    (green pre-fix; falsified by mutating the fix to over-trigger)
// ───────────────────────────────────────────────────────────────────────────

describe('#10789 a seam that answers with no rows still reports no-split', () => {
  it.each(['sqlite', 'pg', 'mysql'] as const)(
    '[preserved] an empty result set in the %s spelling is an ANSWER, not a non-answer',
    async (spelling) => {
      // This is the half that stops the fix being vacuous. An empty result set
      // is the overwhelmingly common case — every healthy install, every boot
      // before a split exists — and all three dialects spell it differently.
      // A non-answer check that rejected any of these would turn every healthy
      // SQL install's boot status into `absent`.
      const log = createLogger();
      const result = await backfillSeedTenancy(
        { exec: answeringEmptySeam(spelling), client: 'better-sqlite3' },
        log as any,
      );

      expect(result.status).toBe('no-split');
      expect(result.detail).toBeUndefined();
      // Still silent, still writes no receipt — a healthy boot narrates nothing.
      expect(log.warn).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
    },
  );

  it('[preserved] the applied path still applies — write statements are NOT held to "must answer"', async () => {
    // ⛔ The guard covers the READ probes only. An UPDATE/DELETE does not return
    // a result set on every dialect (better-sqlite3 through knex reports a
    // change count, mysql2 a `ResultSetHeader`), so holding the write
    // statements to the same standard would break the repair on the very
    // installs it exists for. This seam answers every SELECT and hands back a
    // NON-result-set for every write — and the repair must still complete.
    const writes: string[] = [];
    const exec: SeedTenancyExec = async (sql: string) => {
      if (sql.startsWith('UPDATE') || sql.startsWith('DELETE')) {
        writes.push(sql.slice(0, 6));
        return { affectedRows: 3 }; // not a result set, by design
      }
      if (sql.includes('WHERE 1 = 0')) return [];
      if (sql.includes('LEFT JOIN')) {
        return [
          { object: 'crm_case', field: 'case_number', global_last_value: 38, organization_last_value: 1 },
        ];
      }
      if (sql.includes(ORGANIZATION_TABLE)) return [{ id: 'org_a' }];
      if (sql.includes('rows_holding')) return [];
      if (sql.includes('tenant_id')) return [{ tenant_id: 'org_a', last_value: 1 }];
      return [];
    };

    const result = await backfillSeedTenancy({ exec, client: 'better-sqlite3' }, createLogger() as any);

    expect(result.status).toBe('applied');
    expect(result.objectsStamped).toBe(1);
    expect(result.organizationId).toBe('org_a');
    expect(writes).toContain('UPDATE');
    expect(writes).toContain('DELETE');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. NON-EFFECTS — the branches that must not move
// ───────────────────────────────────────────────────────────────────────────

describe('#10789 the branches this fix must leave alone', () => {
  it('[non-effect] no-driver still fires where it fires today', async () => {
    // A host with no raw-SQL-capable driver at all resolves to no seam, and that
    // is still a different answer from a seam that cannot answer.
    expect(resolveSeedTenancySeam({})).toBeUndefined();
    const result = await backfillSeedTenancy(resolveSeedTenancySeam({}), createLogger() as any);
    expect(result.status).toBe('no-driver');
  });

  it('[non-effect] a seam that THROWS is unchanged — that path was never the defect', async () => {
    // Throwing is a driver present and refusing LOUDLY, and step 1's `catch`
    // already reported it honestly as `absent`. Only a seam that RETURNS a
    // non-answer was invisible, so only that one changed.
    const result = await backfillSeedTenancy(
      {
        exec: async () => {
          throw new Error('ECONNREFUSED');
        },
        client: 'better-sqlite3',
      },
      createLogger() as any,
    );

    expect(result.status).toBe('absent');
    // No `detail` from the non-answer branch: this one did not take it.
    expect(result.detail).toBeUndefined();
  });

  it('[non-effect] the split probe throwing still reports absent with the driver message', async () => {
    const result = await backfillSeedTenancy(
      {
        exec: async (sql: string) => {
          if (sql.includes('WHERE 1 = 0')) return [];
          throw new Error('no such table: _objectstack_sequences');
        },
        client: 'better-sqlite3',
      },
      createLogger() as any,
    );

    expect(result.status).toBe('absent');
    expect(result.detail).toMatch(/no such table/);
  });

  it('[non-effect] a real split is still detected and still reaches the guards', async () => {
    // The multi-tenant skip is reached through the same two probes the fix now
    // guards, so a fix that rejected a legitimate answer would silently stop
    // this branch from ever running.
    const exec: SeedTenancyExec = async (sql: string) => {
      if (sql.includes('WHERE 1 = 0')) return [];
      if (sql.includes('LEFT JOIN')) {
        return [
          { object: 'crm_case', field: 'case_number', global_last_value: 38, organization_last_value: 1 },
        ];
      }
      if (sql.includes(ORGANIZATION_TABLE)) return [{ id: 'org_a' }, { id: 'org_b' }];
      return [];
    };

    const result = await backfillSeedTenancy({ exec, client: 'better-sqlite3' }, createLogger() as any);

    // Two organizations, so the owner is not derivable — the loud skip, not a
    // silent no-op and not `absent`.
    expect(result.status).toBe('skipped-ambiguous-organization');
    expect(result.splits).toEqual([
      { object: 'crm_case', field: 'case_number', globalLastValue: 38, organizationLastValue: 1 },
    ]);
    expect(GLOBAL_TENANT).toBe('__global__');
  });
});
