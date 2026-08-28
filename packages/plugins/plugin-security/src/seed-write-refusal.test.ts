// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A REFUSED catalog write must be loud — the seeder must never report a
 * successful seed of zero rows.
 *
 * # The defect these pin
 *
 * The catalog seeders answered a refused write with `null`/`false`, which is
 * byte-for-byte the answer for "nothing to do": the `seeded` counter never
 * incremented and the pass returned normally. On a deployment still enforcing a
 * PLATFORM-WIDE unique index on the name column — the shape that predates
 * per-organization materialization — EVERY per-organization insert is refused
 * that way, so a deployed plane ran for weeks with an empty RBAC catalog under
 * a clean boot log.
 *
 * ⭐ The outer handler on the organization-creation hook is not missing; it is
 * DISARMED. `security-plugin.ts` already wraps `seedCatalogForOrganization` in
 * a `try`/`catch` that warns, and it is unreachable for this failure class: the
 * refusal is converted to `null` three call layers below, so the `await`
 * resolves normally and the hook logs "RBAC catalog seeded" at `info` over a
 * seed of nothing. Another outer `try`/`catch` fixes nothing — the signal has
 * to survive the inner helper. That is what these tests pin.
 *
 * # What is pinned, and why each one
 *
 * 1. a refused INSERT produces the warning AND the pass still RETURNS — loud
 *    is the ask, fatal is not: a rethrow would turn a silent degradation into a
 *    boot failure on every deployment carrying the legacy index;
 * 2. the warning is AGGREGATED — N refusals in one pass produce one line, not
 *    N, the same discipline `warnOrganizationLessRows` is built on (a catalog
 *    that refuses 400 rows must not print 400 warnings and bury the remedy);
 * 3. a NON-unique-violation refusal is not silently reclassified as one — it
 *    gets its own line, because the migrate remedy does not apply to it and
 *    sending an operator to `os migrate` for a failure no migration can touch
 *    is a confident wrong answer;
 * 4. the existing green path still reports its counts unchanged.
 *
 * The classification is the SHIPPED predicate's (`isUniqueViolationError` in
 * `@objectstack/types`), never a local `23505` / `ER_DUP_ENTRY` regex — the
 * four-mutually-different-answers defect that module was written to retire. The
 * error spellings below are taken from that module's own MEASURED fixtures
 * (`unique-violation-absence-sentences.test.ts`, raised on live SQLite,
 * PostgreSQL 16.13 and MariaDB 10.11.14), never invented here.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { bootstrapBuiltinRoles } from './bootstrap-builtin-positions.js';
import {
  createSeedWriteRefusals,
  warnSeedWriteRefusals,
} from './per-organization-catalog.js';

/* ------------------------------------------------------------------------- *
 *  Measured driver errors — spellings copied from the shipped classifier's
 *  own live-server fixtures, not transcribed from memory.
 * ------------------------------------------------------------------------- */

/** MySQL/MariaDB 1062. Names an INDEX, never a column — the usual case here. */
function mysqlDuplicateEntry(): Error & { code: string; errno: number } {
  return Object.assign(
    new Error("Duplicate entry 'contributor' for key 'sys_position_name_unique'"),
    { code: 'ER_DUP_ENTRY', errno: 1062 },
  );
}

/** PostgreSQL 23505. Names a CONSTRAINT — also not a column. */
function postgresUniqueViolation(): Error & { code: string } {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "sys_position_name_unique"'),
    { code: '23505' },
  );
}

/** SQLite, the one dialect that determinably names a COLUMN. */
function sqliteUniqueViolation(): Error {
  return new Error('UNIQUE constraint failed: sys_position.name');
}

/** NOT a unique violation. Must never be relabelled as one. */
function connectionFailure(): Error & { code: string } {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
    code: 'ECONNREFUSED',
  });
}

/* ------------------------------------------------------------------------- *
 *  Doubles
 * ------------------------------------------------------------------------- */

interface WarnLine {
  message: string;
  meta: Record<string, any>;
}

function makeLogger() {
  const warns: WarnLine[] = [];
  const infos: WarnLine[] = [];
  return {
    warns,
    infos,
    logger: {
      info: (message: string, meta?: Record<string, any>) => {
        infos.push({ message, meta: meta ?? {} });
      },
      warn: (message: string, meta?: Record<string, any>) => {
        warns.push({ message, meta: meta ?? {} });
      },
    },
  };
}

/**
 * `sys_position` double whose INSERT is vetoed the way a legacy platform-wide
 * unique index vetoes it: the row never lands and the driver throws.
 *
 * Modelled on the double in `bootstrap-declared-positions.test.ts` — `$in` is
 * supported because the seeders hoist one batched existence read out of their
 * loop, and a double that answered `[]` to `$in` would report "nothing is
 * seeded" and make every re-seed look like a first boot.
 */
function makeQl(
  declared: any[] = [],
  opts: { insertThrows?: () => unknown; updateThrows?: () => unknown } = {},
) {
  const rows: any[] = [];
  return {
    rows,
    registry: { listItems: (type: string) => (type === 'position' ? [...declared] : []) },
    async find(object: string, q: any) {
      if (object !== 'sys_position') return [];
      const where = q?.where ?? {};
      const matched = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          // Refuse what this double does not implement, rather than reading a
          // combinator as a field name and silently matching nothing.
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const inList = (v as any).$in;
            if (Array.isArray(inList)) return inList.includes(r[k]);
            throw new Error(`fake driver: unsupported operator ${Object.keys(v).join(',')}`);
          }
          return r[k] === v;
        }),
      );
      // The caller's bound is applied AFTER the filter, by presence: a double
      // that silently drops `limit` answers a different question than the real
      // engine and hides a paging defect from every test that uses it.
      return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
    },
    async insert(object: string, data: any) {
      if (opts.insertThrows) throw opts.insertThrows();
      if (object !== 'sys_position') return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    // Pinned to ObjectQL.update's own dispatch predicate: a fake looser than
    // the real engine is how a dead call shape ships with its suite green.
    async update(object: string, data: any, options?: any) {
      if (opts.updateThrows) throw opts.updateThrows();
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (object !== 'sys_position') return dispatch.kind === 'by-id' ? null : 0;
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows;
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
  };
}

const THREE_POSITIONS = [
  { name: 'contributor', label: 'Contributor', description: 'Does work' },
  { name: 'reviewer', label: 'Reviewer', description: 'Reviews work' },
  { name: 'approver', label: 'Approver', description: 'Approves work' },
];

/** The refusal warnings this change adds, as opposed to any pre-existing ones. */
function refusalWarnings(warns: WarnLine[]): WarnLine[] {
  return warns.filter((w) => typeof w.meta.refused === 'number');
}

/* ------------------------------------------------------------------------- *
 *  1 — a refused INSERT is LOUD, and the pass still returns
 * ------------------------------------------------------------------------- */

describe('a unique-violation refusal during catalog seeding is boot-visible', () => {
  it('warns, and does NOT throw, when every declared position is vetoed', async () => {
    const { logger, warns } = makeLogger();
    const ql = makeQl(THREE_POSITIONS, { insertThrows: mysqlDuplicateEntry });

    // ⭐ Resolves rather than rejects. A rethrow would turn a silent
    // degradation into a boot failure on every deployment carrying the legacy
    // index — a behaviour change this repair deliberately does not make.
    const r = await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    // The seed really did land nothing — the defect's precondition holds.
    expect(r.seeded).toBe(0);
    expect(ql.rows).toHaveLength(0);

    const refusals = refusalWarnings(warns);
    expect(refusals).toHaveLength(1);
    const [line] = refusals;
    expect(line.meta).toMatchObject({
      object: 'sys_position',
      organization: 'org_1',
      refused: 3,
      class: 'unique-violation',
    });
    // The value-free code channel is what identifies the dialect's refusal.
    expect(line.meta.driverCodes).toEqual(['1062', 'ER_DUP_ENTRY']);
    // The operator is told it is a deployment-schema defect and given the remedy.
    expect(line.message).toContain('REFUSED BY A UNIQUE CONSTRAINT');
    expect(line.message).toContain('os migrate plan');
    expect(line.message).toContain('os migrate apply');
    // ⭐ And it points at where the COLLIDING INDEX is named — the engine's own
    // redacted entries — rather than reprinting driver text from here.
    expect(line.message).toContain('COLLIDING INDEX');
    expect(line.message).toContain('Insert operation failed');
  });

  it('never echoes the driver message or the bound statement into the warning', async () => {
    const { logger, warns } = makeLogger();
    // A driver message shaped the way knex builds one: the fully bound
    // statement, values inlined, then the database's own diagnostic.
    const leaky = Object.assign(
      new Error(
        "insert into `sys_position` (`id`, `name`, `label`) values ('position_1', " +
          "'contributor', 'SENSITIVE-CANARY-9f3a2b') - Duplicate entry 'contributor' " +
          "for key 'sys_position_name_unique'",
      ),
      { code: 'ER_DUP_ENTRY', errno: 1062 },
    );
    const ql = makeQl(THREE_POSITIONS, { insertThrows: () => leaky });

    await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    const serialized = JSON.stringify(refusalWarnings(warns));
    // [#8682] This is a server LOG, which is exactly the boundary the bound-
    // statement redaction governs. The seeder reads the value-free `code` /
    // `errno` channel and never the message channel, so a canary in the
    // statement cannot reach the log through this line.
    expect(serialized).not.toContain('SENSITIVE-CANARY-9f3a2b');
    expect(serialized).not.toContain('insert into');
  });

  it('reports a refused UPDATE on the same channel as a refused INSERT', async () => {
    const { logger, warns } = makeLogger();
    const ql = makeQl(
      [{ name: 'contributor', label: 'Contributor v2', description: 'new text' }],
      { updateThrows: postgresUniqueViolation },
    );
    ql.rows.push({
      id: 'position_existing', name: 'contributor', label: 'Contributor', description: 'old',
      organization_id: 'org_1',
    });

    const r = await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    expect(r.updated).toBe(0);
    const refusals = refusalWarnings(warns);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].meta).toMatchObject({ refused: 1, class: 'unique-violation' });
    expect(refusals[0].meta.driverCodes).toEqual(['23505']);
  });
});

/* ------------------------------------------------------------------------- *
 *  2 — AGGREGATED: N refusals produce ONE line
 * ------------------------------------------------------------------------- */

describe('the refusal warning is aggregated, not one line per refused row', () => {
  it('prints ONE line for 40 refusals in a single pass', async () => {
    const { logger, warns } = makeLogger();
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `position_${i}`, label: `Position ${i}`, description: 'x',
    }));
    const ql = makeQl(many, { insertThrows: mysqlDuplicateEntry });

    const r = await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    expect(r.seeded).toBe(0);
    const refusals = refusalWarnings(warns);
    // ⭐ ONE actionable line per object per class per pass. The alternative
    // floods the boot log and buries the one sentence naming the remedy —
    // the same reason `warnOrganizationLessRows` aggregates.
    expect(refusals).toHaveLength(1);
    // …and it still carries the true count, so the line is a report and not
    // merely a sample.
    expect(refusals[0].meta.refused).toBe(40);
  });

  it('aggregates the built-in position pass the same way', async () => {
    const { logger, warns } = makeLogger();
    const ql = makeQl([], { insertThrows: mysqlDuplicateEntry });

    const r = await bootstrapBuiltinRoles(ql, { logger, organizationId: 'org_1' });

    expect(r.seeded).toBe(0);
    const refusals = refusalWarnings(warns);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].meta.refused).toBeGreaterThan(1);
    expect(refusals[0].meta.class).toBe('unique-violation');
  });
});

/* ------------------------------------------------------------------------- *
 *  3 — a NON-unique-violation is not reclassified
 * ------------------------------------------------------------------------- */

describe('a refusal that is not a unique violation keeps its own class', () => {
  it('does not send the operator to `os migrate` for a connection failure', async () => {
    const { logger, warns } = makeLogger();
    const ql = makeQl(THREE_POSITIONS, { insertThrows: connectionFailure });

    await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    const refusals = refusalWarnings(warns);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].meta).toMatchObject({ refused: 3, class: 'other' });
    expect(refusals[0].message).toContain('NOT a unique-constraint violation');
    // ⭐ The migrate remedy belongs to the OTHER class and must not appear
    // here: no migration can repair a database that is unreachable, and a
    // confident wrong remedy is worse than none.
    expect(refusals[0].message).not.toContain('os migrate plan');
  });

  it('separates the two classes into two lines when a pass sees both', () => {
    const { logger, warns } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());
    refusals.record('sys_position', mysqlDuplicateEntry());
    refusals.record('sys_position', connectionFailure());
    expect(refusals.total).toBe(3);

    warnSeedWriteRefusals(logger, refusals, 'org_1');

    expect(warns).toHaveLength(2);
    const byClass = Object.fromEntries(warns.map((w) => [w.meta.class, w.meta.refused]));
    expect(byClass).toEqual({ 'unique-violation': 2, other: 1 });
  });

  it('does not read a unique violation out of an ABSENCE sentence', () => {
    const { logger, warns } = makeLogger();
    const refusals = createSeedWriteRefusals();
    // The words "unique constraint" are adjacent here and the sentence says
    // there is NONE (PostgreSQL 42830). The shipped predicate answers `false`;
    // this file must not answer otherwise.
    refusals.record(
      'sys_position',
      new Error(
        'there is no unique constraint matching given keys for referenced table "sys_position"',
      ),
    );

    warnSeedWriteRefusals(logger, refusals, 'org_1');

    expect(warns).toHaveLength(1);
    expect(warns[0].meta.class).toBe('other');
  });

  it('names the conflicting COLUMN only when the dialect determinably gave one', () => {
    const { logger, warns } = makeLogger();

    const sqlite = createSeedWriteRefusals();
    sqlite.record('sys_position', sqliteUniqueViolation());
    warnSeedWriteRefusals(logger, sqlite, 'org_1');
    expect(warns[0].meta.columns).toEqual(['name']);

    warns.length = 0;
    const mysql = createSeedWriteRefusals();
    mysql.record('sys_position', mysqlDuplicateEntry());
    warnSeedWriteRefusals(logger, mysql, 'org_1');
    // ⛔ MySQL's `for key '…'` names an INDEX. The shipped extractor refuses to
    // read a column out of it (maintainer ruling, 2026-08-08), and this line
    // prints no `columns` key rather than a plausible-looking wrong field.
    expect(warns[0].meta.columns).toBeUndefined();
    expect(JSON.stringify(warns[0].meta)).not.toContain('sys_position_name_unique');
  });

  it('reports each object on its own line', () => {
    const { logger, warns } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_permission_set', postgresUniqueViolation());
    refusals.record('sys_position', postgresUniqueViolation());

    warnSeedWriteRefusals(logger, refusals, 'org_1');

    expect(warns.map((w) => w.meta.object)).toEqual(['sys_permission_set', 'sys_position']);
  });
});

/* ------------------------------------------------------------------------- *
 *  4 — the green path is unchanged
 * ------------------------------------------------------------------------- */

describe('a pass that is not refused reports exactly what it did before', () => {
  it('says nothing about refusals and reports its counts unchanged', async () => {
    const { logger, warns } = makeLogger();
    const ql = makeQl(THREE_POSITIONS);

    const r = await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    expect(r).toMatchObject({ seeded: 3, updated: 0, unchanged: 0, unreadable: 0 });
    expect(ql.rows).toHaveLength(3);
    // ⭐ Silence on the healthy path is load-bearing: a warning printed on
    // every boot of every deployment is the false-alarm class that trains
    // operators to skim exactly this channel.
    expect(refusalWarnings(warns)).toHaveLength(0);
  });

  it('emits nothing at all when a pass recorded no refusal', () => {
    const { logger, warns } = makeLogger();
    const refusals = createSeedWriteRefusals();
    expect(refusals.total).toBe(0);
    warnSeedWriteRefusals(logger, refusals, 'org_1');
    expect(warns).toHaveLength(0);
  });

  it('survives a logger with no `warn` sink', () => {
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());
    // Hosts do inject reduced sinks. Reporting must not become the thing that
    // breaks the boot it exists to describe.
    expect(() => warnSeedWriteRefusals({}, refusals, 'org_1')).not.toThrow();
    expect(() => warnSeedWriteRefusals(undefined, refusals, 'org_1')).not.toThrow();
  });

  it('marks a `single`-posture pass as such instead of inventing an organization', () => {
    const { logger, warns } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());

    warnSeedWriteRefusals(logger, refusals);

    expect(warns[0].meta.posture).toBe('single');
    expect(warns[0].meta.organization).toBeUndefined();
  });
});
