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
 * [ADR-0131 D2] The cases that drove these through the two position seeders
 * are gone with the seeders. What is pinned here is the shared accumulator
 * (`write-refusals.ts`) the surviving writers report through; each surviving
 * writer's own suite pins its call into it.
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
import {
  createSeedWriteRefusals,
  reportSeedWriteRefusals,
} from './write-refusals.js';

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

/* ------------------------------------------------------------------------- *
 *  1 — the report never echoes the driver message
 * ------------------------------------------------------------------------- */

describe('a refusal report carries no bound statement', () => {
  it('never echoes the driver message or the bound statement into the line', () => {
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
    const refusals = createSeedWriteRefusals();
    refusals.record('sys_position', leaky);

    reportSeedWriteRefusals(logger, refusals, 'org_1');

    const serialized = JSON.stringify([...warns, ...errors]);
    expect(errors).toHaveLength(1);
    // [#8682] This is a server LOG, which is exactly the boundary the bound-
    // statement redaction governs. The accumulator reads the value-free `code`
    // / `errno` channel and never the message channel, so a canary in the
    // statement cannot reach the log through this line.
    expect(serialized).not.toContain('SENSITIVE-CANARY-9f3a2b');
    expect(serialized).not.toContain('insert into');
  });
});

/* ------------------------------------------------------------------------- *
 *  3 — a NON-unique-violation is not reclassified
 * ------------------------------------------------------------------------- */

describe('a refusal that is not a unique violation keeps its own class', () => {

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
});

/* ------------------------------------------------------------------------- *
 *  4 — the green path is unchanged
 * ------------------------------------------------------------------------- */

describe('a pass that is not refused reports exactly what it did before', () => {

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
 * Measured, twice, rather than assumed — AT THE TIME. This package's
 * `tsconfig.json` excludes `**\/*.test.ts`, and back then that was the package's
 * only word on the subject: `tsc --noEmit --listFiles` reported ZERO
 * plugin-security test files in either program the `typecheck` script ran, so a
 * directive here would not have been evaluated by any of them.
 * `check:type-check-coverage` refuses exactly that shape by name ("carries a
 * `@ts-expect-error` directive but no tsc program the `typecheck` script runs
 * compiles it … replace the pin with a runtime assertion", `PHANTOM_PIN_DEBT`
 * closed to new entries), and it refused this file when the pin was first
 * written that way.
 *
 * [commit a68c61267] the sibling `tsconfig.test.json` compiles this file, so that
 * measurement no longer holds and a directive here WOULD be evaluated. The pin
 * stays a runtime assertion over the declaration's own AST anyway, and now for
 * its own reason rather than for the absent compiler: it reads OPTIONALITY off
 * the type alias's AST, which is a property no single `@ts-expect-error` call
 * site expresses — and it survives removal of
 * `check:optional-error-sink-contract`, which is the point. That gate found the
 * hole; the property belongs to this module.
 *
 * ⚠️ Seeded from `__dirname` rather than `import.meta.url`. The original reason
 * is spent and is recorded because it is the cost of a hidden layer, not a
 * footnote: under the inherited `module: NodeNext` this package resolves as
 * CommonJS, `import.meta` is TS1470 there, and that one diagnostic would have
 * pushed the shrink-only TEST_DEBT ratchet from 11 to 12 — so a source file was
 * shaped around a program whose verdict nothing ever ran. `tsconfig.test.json`
 * matches how vitest executes this layer (`module: esnext`), where
 * `import.meta` is legal; `__dirname` is left in place because it works under
 * both and churning it buys nothing.
 */
describe('SeedLogger guarantees the channel a durability report degrades to', () => {
  const CATALOG_SOURCE = resolve(__dirname, 'write-refusals.ts');

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
