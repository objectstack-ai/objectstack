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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';
import { bootstrapBuiltinRoles } from './bootstrap-builtin-positions.js';
import {
  createSeedWriteRefusals,
  reportSeedWriteRefusals,
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

/**
 * A FULL sink — `info`, `warn` and `error`, with `error` carrying the kernel
 * `Logger` arity (`message, cause?, meta?`). The cause slot is captured too,
 * so a test can prove the meta object did not land in it.
 */
function makeLogger() {
  const warns: WarnLine[] = [];
  const infos: WarnLine[] = [];
  const errors: Array<WarnLine & { cause: unknown }> = [];
  return {
    warns,
    infos,
    errors,
    logger: {
      info: (message: string, meta?: Record<string, any>) => {
        infos.push({ message, meta: meta ?? {} });
      },
      warn: (message: string, meta?: Record<string, any>) => {
        warns.push({ message, meta: meta ?? {} });
      },
      error: (message: string, cause?: Error, meta?: Record<string, any>) => {
        errors.push({ message, cause, meta: meta ?? {} });
      },
    },
  };
}

/**
 * A REDUCED sink — the shape hosts legitimately inject, with no `error`.
 * This is the case a bare `logger?.error?.(...)` would answer with silence.
 */
function makeWarnOnlyLogger() {
  const warns: WarnLine[] = [];
  return {
    warns,
    logger: {
      info: (_m: string, _meta?: Record<string, any>) => {},
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

/**
 * The refusal lines this change adds, as opposed to any pre-existing ones —
 * gathered across BOTH sinks, because the two classes deliberately land on
 * different channels. A test that watched only `warn` would read the
 * unique-violation line's promotion to `error` as its disappearance.
 */
function refusalLines(...sinks: WarnLine[][]): WarnLine[] {
  return sinks.flat().filter((w) => typeof w.meta.refused === 'number');
}

/* ------------------------------------------------------------------------- *
 *  1 — a refused INSERT is LOUD, and the pass still returns
 * ------------------------------------------------------------------------- */

describe('a unique-violation refusal during catalog seeding is boot-visible', () => {
  it('warns, and does NOT throw, when every declared position is vetoed', async () => {
    const { logger, warns, errors } = makeLogger();
    const ql = makeQl(THREE_POSITIONS, { insertThrows: mysqlDuplicateEntry });

    // ⭐ Resolves rather than rejects. A rethrow would turn a silent
    // degradation into a boot failure on every deployment carrying the legacy
    // index — a behaviour change this repair deliberately does not make.
    const r = await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    // The seed really did land nothing — the defect's precondition holds.
    expect(r.seeded).toBe(0);
    expect(ql.rows).toHaveLength(0);

    // ⭐ On the DURABILITY channel, not the functional one: the boot goes on to
    // look healthy while a catalog it reported as seeded did not land.
    expect(errors).toHaveLength(1);
    expect(refusalLines(warns)).toHaveLength(0);
    const [line] = errors;
    // The cause slot stays empty and the detail travels in meta — a summary of
    // N refusals has no single cause, and putting meta in the cause slot is
    // where a `Logger` neither reads nor serializes it.
    expect(line.cause).toBeUndefined();
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
    const { logger, warns, errors } = makeLogger();
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

    const serialized = JSON.stringify(refusalLines(warns, errors));
    // [#8682] This is a server LOG, which is exactly the boundary the bound-
    // statement redaction governs. The seeder reads the value-free `code` /
    // `errno` channel and never the message channel, so a canary in the
    // statement cannot reach the log through this line.
    expect(serialized).not.toContain('SENSITIVE-CANARY-9f3a2b');
    expect(serialized).not.toContain('insert into');
  });

  it('reports a refused UPDATE on the same channel as a refused INSERT', async () => {
    const { logger, warns, errors } = makeLogger();
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
    const refusals = refusalLines(warns, errors);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].meta).toMatchObject({ refused: 1, class: 'unique-violation' });
    expect(refusals[0].meta.driverCodes).toEqual(['23505']);
    expect(errors).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------- *
 *  2 — AGGREGATED: N refusals produce ONE line
 * ------------------------------------------------------------------------- */

describe('the refusal warning is aggregated, not one line per refused row', () => {
  it('prints ONE line for 40 refusals in a single pass', async () => {
    const { logger, warns, errors } = makeLogger();
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `position_${i}`, label: `Position ${i}`, description: 'x',
    }));
    const ql = makeQl(many, { insertThrows: mysqlDuplicateEntry });

    const r = await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    expect(r.seeded).toBe(0);
    const refusals = refusalLines(warns, errors);
    // ⭐ ONE actionable line per object per class per pass. The alternative
    // floods the boot log and buries the one sentence naming the remedy —
    // the same reason `warnOrganizationLessRows` aggregates.
    expect(refusals).toHaveLength(1);
    // …and it still carries the true count, so the line is a report and not
    // merely a sample.
    expect(refusals[0].meta.refused).toBe(40);
  });

  it('aggregates the built-in position pass the same way', async () => {
    const { logger, warns, errors } = makeLogger();
    const ql = makeQl([], { insertThrows: mysqlDuplicateEntry });

    const r = await bootstrapBuiltinRoles(ql, { logger, organizationId: 'org_1' });

    expect(r.seeded).toBe(0);
    const refusals = refusalLines(warns, errors);
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
    const { logger, warns, errors } = makeLogger();
    const ql = makeQl(THREE_POSITIONS, { insertThrows: connectionFailure });

    await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    // ⭐ FUNCTIONAL channel, deliberately. Escalating a retrying outage to
    // `error` is the over-application that trains everyone to skim `error`,
    // which is what made the founding incident's `warn` unreadable.
    expect(errors).toHaveLength(0);
    const refusals = refusalLines(warns);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].meta).toMatchObject({ refused: 3, class: 'other' });
    expect(refusals[0].message).toContain('NOT a unique-constraint violation');
    // ⭐ The migrate remedy belongs to the OTHER class and must not appear
    // here: no migration can repair a database that is unreachable, and a
    // confident wrong remedy is worse than none.
    expect(refusals[0].message).not.toContain('os migrate plan');
  });

  it('separates the two classes into two lines when a pass sees both', () => {
    const { logger, warns, errors } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());
    refusals.record('sys_position', mysqlDuplicateEntry());
    refusals.record('sys_position', connectionFailure());
    expect(refusals.total).toBe(3);

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    // ⭐ Two lines AND two channels: durability for the class that leaves the
    // deployment looking healthy, functional for the one that retries.
    expect(errors).toHaveLength(1);
    expect(errors[0].meta).toMatchObject({ class: 'unique-violation', refused: 2 });
    expect(warns).toHaveLength(1);
    expect(warns[0].meta).toMatchObject({ class: 'other', refused: 1 });
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

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    expect(warns).toHaveLength(1);
    expect(warns[0].meta.class).toBe('other');
  });

  it('names the conflicting COLUMN only when the dialect determinably gave one', () => {
    const { logger, errors } = makeLogger();

    const sqlite = createSeedWriteRefusals();
    sqlite.record('sys_position', sqliteUniqueViolation());
    reportSeedWriteRefusals(logger, sqlite, 'org_1');
    expect(errors[0].meta.columns).toEqual(['name']);

    errors.length = 0;
    const mysql = createSeedWriteRefusals();
    mysql.record('sys_position', mysqlDuplicateEntry());
    reportSeedWriteRefusals(logger, mysql, 'org_1');
    // ⛔ MySQL's `for key '…'` names an INDEX. The shipped extractor refuses to
    // read a column out of it (maintainer ruling, 2026-08-08), and this line
    // prints no `columns` key rather than a plausible-looking wrong field.
    expect(errors[0].meta.columns).toBeUndefined();
    expect(JSON.stringify(errors[0].meta)).not.toContain('sys_position_name_unique');
  });

  it('reports each object on its own line', () => {
    const { logger, errors } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_permission_set', postgresUniqueViolation());
    refusals.record('sys_position', postgresUniqueViolation());

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    expect(errors.map((w) => w.meta.object)).toEqual(['sys_permission_set', 'sys_position']);
  });
});

/* ------------------------------------------------------------------------- *
 *  3b — the LEVEL split, and the fallback that keeps it from costing silence
 * ------------------------------------------------------------------------- */

describe('the two classes take different log levels (AGENTS.md degradation rule)', () => {
  /**
   * The rule's one question: *after the degradation, does the system still
   * look normal from the outside while something it claims is persisted has
   * not actually landed?* For a refused catalog seed the answer is yes — the
   * boot goes on to log "RBAC catalog seeded" at `info` over zero rows.
   *
   * This is #4420's shape on a different table: the durable suspended-run
   * store was attached to a table that was never created, every write failed
   * into a `warn` nobody read, and each restart silently dropped every
   * in-flight approval while the system reported itself healthy throughout.
   */
  it('routes a unique violation to `error` and never to `warn`', () => {
    const { logger, warns, errors } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    expect(errors).toHaveLength(1);
    expect(warns).toHaveLength(0);
    expect(errors[0].meta.class).toBe('unique-violation');
  });

  it('states the consequence AND the fix in the durability line', () => {
    const { logger, errors } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    // ① the consequence, concretely — including that nothing else will look
    // wrong, which is the half an operator cannot infer.
    expect(errors[0].message).toContain('THE DEPLOYMENT WILL GO ON LOOKING HEALTHY');
    // ② the fix.
    expect(errors[0].message).toContain('os migrate plan');
  });

  it('routes a non-unique-violation refusal to `warn` and never to `error`', () => {
    const { logger, warns, errors } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', connectionFailure());

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    expect(warns).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(warns[0].meta.class).toBe('other');
  });

  /**
   * ⭐ The case a bare `logger?.error?.(...)` fails. Hosts legitimately inject
   * reduced sinks, and against one of those that spelling prints NOTHING —
   * silently dropping the loudest line in this change to satisfy a matcher.
   */
  it('delivers the unique-violation line through `warn` when the host injected no `error` sink', () => {
    const { logger, warns } = makeWarnOnlyLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    // Not silence: the message arrives, whole, on the channel that exists.
    expect(warns).toHaveLength(1);
    expect(warns[0].meta.class).toBe('unique-violation');
    expect(warns[0].message).toContain('REFUSED BY A UNIQUE CONSTRAINT');
    expect(warns[0].message).toContain('os migrate plan');
    // …and the meta rides along rather than being dropped into an argument
    // slot the reduced sink does not have.
    expect(warns[0].meta.refused).toBe(1);
  });

  it('reaches the durability channel through the real seeder, not just the helper', async () => {
    const { logger, warns, errors } = makeLogger();
    const ql = makeQl(THREE_POSITIONS, { insertThrows: postgresUniqueViolation });

    await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    expect(errors).toHaveLength(1);
    expect(refusalLines(warns)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- *
 *  4 — the green path is unchanged
 * ------------------------------------------------------------------------- */

describe('a pass that is not refused reports exactly what it did before', () => {
  it('says nothing about refusals and reports its counts unchanged', async () => {
    const { logger, warns, errors } = makeLogger();
    const ql = makeQl(THREE_POSITIONS);

    const r = await bootstrapDeclaredPositions(ql, null, { logger, organizationId: 'org_1' });

    expect(r).toMatchObject({ seeded: 3, updated: 0, unchanged: 0, unreadable: 0 });
    expect(ql.rows).toHaveLength(3);
    // ⭐ Silence on the healthy path is load-bearing: a warning printed on
    // every boot of every deployment is the false-alarm class that trains
    // operators to skim exactly this channel.
    expect(refusalLines(warns, errors)).toHaveLength(0);
  });

  it('emits nothing at all when a pass recorded no refusal', () => {
    const { logger, warns } = makeLogger();
    const refusals = createSeedWriteRefusals();
    expect(refusals.total).toBe(0);
    reportSeedWriteRefusals(logger, refusals, 'org_1');
    expect(warns).toHaveLength(0);
  });

  it('survives an absent logger entirely', () => {
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());
    // Reporting must not become the thing that breaks the boot it exists to
    // describe. `{}` is deliberately NOT exercised here: since `warn` became
    // non-optional it is no longer a `SeedLogger` at all — see the type pin
    // below, which is where that property is asserted.
    expect(() => reportSeedWriteRefusals(undefined, refusals, 'org_1')).not.toThrow();
  });

  it('marks a `single`-posture pass as such instead of inventing an organization', () => {
    const { logger, errors } = makeLogger();
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());

    reportSeedWriteRefusals(logger, refusals);

    expect(errors[0].meta.posture).toBe('single');
    expect(errors[0].meta.organization).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------- *
 *  5 — the fallback channel is guaranteed by the TYPE, not by convention
 * ------------------------------------------------------------------------- */

/**
 * ## The property
 *
 * `error` is optional because hosts legitimately inject reduced sinks. That
 * makes `warn` the channel a durability report DEGRADES to — and a fallback
 * that may itself be absent is not a fallback. While both were optional, `{}`
 * satisfied `SeedLogger` and every value of the type was permitted to print
 * nothing, which no call-site spelling can repair. Only the type can.
 *
 * ## Why this reads the declaration instead of using `@ts-expect-error`
 *
 * Measured, twice, rather than assumed. This package's `tsconfig.json` excludes
 * `**\/*.test.ts` and `tsc --noEmit --listFiles` reports ZERO plugin-security
 * test files in the program its `typecheck` script runs — so a directive here
 * would not be evaluated by that script. `check:type-check-coverage` refuses
 * exactly that shape by name ("carries a `@ts-expect-error` directive but no
 * tsc program the `typecheck` script runs compiles it … replace the pin with a
 * runtime assertion", `PHANTOM_PIN_DEBT` closed to new entries), and it refused
 * this file when the pin was first written that way.
 *
 * So the pin is a runtime assertion over the declaration's own AST. It survives
 * removal of `check:optional-error-sink-contract`, which is the point — that
 * gate found the hole, but the property belongs to this module.
 *
 * ⚠️ Seeded from `__dirname`, not `import.meta.url`: under `module: NodeNext`
 * this package resolves as CommonJS, where `import.meta` is TS1470 and pushed
 * the shrink-only TEST_DEBT ratchet from 11 to 12.
 */
describe('SeedLogger guarantees the channel a durability report degrades to', () => {
  const CATALOG_SOURCE = resolve(__dirname, 'per-organization-catalog.ts');

  /** Declared members of the `SeedLogger` type alias, mapped to their optionality. */
  function seedLoggerMembers(): Map<string, boolean> {
    const sourceFile = ts.createSourceFile(
      CATALOG_SOURCE,
      readFileSync(CATALOG_SOURCE, 'utf8'),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );
    let members: Map<string, boolean> | undefined;
    sourceFile.forEachChild((node) => {
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === 'SeedLogger' &&
        ts.isTypeLiteralNode(node.type)
      ) {
        members = new Map(
          node.type.members
            .filter(ts.isPropertySignature)
            .map((m) => [(m.name as ts.Identifier).text, m.questionToken !== undefined]),
        );
      }
    });
    // A pin that silently stops finding its subject is worse than no pin: it
    // would go green over a renamed or restructured declaration.
    if (!members) throw new Error('SeedLogger type alias not found — this pin lost its subject');
    return members;
  }

  it('finds the declaration it is pinning', () => {
    expect([...seedLoggerMembers().keys()].sort()).toEqual(['error', 'info', 'warn']);
  });

  it('declares `warn` NON-optional — so no value of the type can be silent', () => {
    // ⭐ The whole property: `{ info }` alone, or `{}`, must not be a SeedLogger.
    expect(seedLoggerMembers().get('warn')).toBe(false);
  });

  it('keeps `error` optional — reduced sinks stay representable', () => {
    // ⛔ Making `error` required is the measured-and-rejected repair: it would
    // foreclose the very hosts the fallback exists for.
    expect(seedLoggerMembers().get('error')).toBe(true);
  });

  it('does not let a required `info` stand in for the guarantee', () => {
    // A lost write reported at `info` is the reassuring half-truth the
    // degradation-level rule exists to remove, so `info` carries no guarantee.
    expect(seedLoggerMembers().get('info')).toBe(true);
  });

  it('serves the reduced sink rather than going silent', () => {
    // The type-level guarantee's whole purpose, observed end to end.
    const warns: WarnLine[] = [];
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', mysqlDuplicateEntry());
    reportSeedWriteRefusals(
      { warn: (message, meta) => warns.push({ message, meta: meta ?? {} }) },
      refusals,
      'org_1',
    );
    expect(warns).toHaveLength(1);
    expect(warns[0].meta.class).toBe('unique-violation');
  });
});
