// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13273 — a `find` that failed because the table was never created is not the
 * same fact as a `find` that FAILED, and the two must not share a log level.
 *
 * ## What was measured, and where
 *
 * `os migrate plan --database-url file:<an unmigrated sqlite db>`, run from an
 * example app with `NODE_ENV=production` — the ordinary first run, and exactly
 * the run the command exists to describe. It exits 0 and prints a correct plan.
 * On the way there it emitted **five** `ERROR Find operation failed` records
 * with full stack traces, one per boot-path probe of a table that does not
 * exist yet:
 *
 * | caller | object |
 * |:---|:---|
 * | `readAuthoredTranslationLayer` (`core/src/fallbacks/authored-translation-sync.ts`) | `sys_metadata` |
 * | `ObjectQLPlugin.readAuthoredHookRows` (`objectql/src/plugin.ts`) | `sys_metadata` |
 * | `ObjectQLPlugin.readAuthoredActionRows` (`objectql/src/plugin.ts`) | `sys_metadata` |
 * | `ObjectStoreActionActivationStore.probe` (`objectql/src/action-activation.ts`) | `sys_metadata_activation` |
 * | `ObjectQL.readMigrationFlagVerified` (`objectql/src/engine.ts`) | `sys_migration` |
 *
 * Every one of those callers treats a missing table as a normal answer and says
 * so in its own code — `readMigrationFlagVerified`'s "an unreadable table …
 * → false", the two re-syncs' `authoredRows: 0`, and the activation probe's
 * caller, which already follows the frame with a `warn` stating the consequence
 * in operator terms. So the `error` channel was firing for a condition every
 * consumer downstream of it handles as routine, which is the over-application
 * that trains operators to skim `error`.
 *
 * ## ⛔ What this file pins is a DISCRIMINATION, not a silence
 *
 * The whole risk in a fix of this shape is collapsing "the table does not exist
 * yet" into "the read failed" — which would buy a quiet log by making a real
 * outage quiet too. So every zero here is paired with a positive control on the
 * same seam: for each demoted class there is a sibling case that must still be
 * loud, and the file fails if either half moves.
 *
 * Three things are deliberately NOT changed and are pinned as such:
 *
 *   1. **The throw.** Both branches rethrow, byte-identical, so no caller's
 *      control flow depends on the level chosen here.
 *   2. **The write verbs.** `insert`/`update`/`delete` keep an unconditional
 *      `error` — a write to a table that does not exist is not a normal answer
 *      for any caller, and nothing landed.
 *   3. **The `excludes` boundary** (#6347). Postgres' `column "x" of relation
 *      "y" does not exist` CONTAINS a legal missing-table phrase but is a
 *      column fault on a table that exists. It stays `error`.
 *
 * Drives a fake DRIVER (not a fake engine), so no engine write-verb dispatch
 * contract is involved.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine';

/** The object under read — registered, so the read reaches the driver. */
const OBJECT = 'sys_probe';

/**
 * The driver's own envelope, reproduced. `SqlDriver.backendStatementFault`
 * composes this message and hangs the dialect error off a NON-ENUMERABLE
 * `cause`, which is the only place the "no such table" text survives — so a
 * classifier that reads the top-level message alone answers "not benign" here.
 * Reproducing the envelope rather than throwing the raw dialect error is the
 * point: it is what the engine actually catches in production.
 */
function envelope(cause: unknown): Error {
  const err = new Error(
    `The database refused to run this query for object '${OBJECT}'. The driver could not ` +
      'attribute the failure to any part of the request, so no verdict about the query is ' +
      "claimed here. The backend's own diagnostic and the compiled statement were written " +
      'to the server log for an operator to read.',
  ) as Error & { code?: string; status?: number };
  err.code = 'DATABASE_ERROR';
  Object.defineProperty(err, 'cause', {
    value: cause,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return err;
}

/** "The table has not been provisioned", in each dialect's own words. */
const MISSING_TABLE: Array<[string, () => unknown]> = [
  ['SQLite / libsql message-only', () => new Error(`no such table: ${OBJECT}`)],
  [
    'PostgreSQL 42P01 undefined_table',
    () => Object.assign(new Error(`relation "${OBJECT}" does not exist`), { code: '42P01' }),
  ],
  [
    'MySQL ER_NO_SUCH_TABLE',
    () =>
      Object.assign(new Error(`Table 'app.${OBJECT}' doesn't exist`), {
        code: 'ER_NO_SUCH_TABLE',
        errno: 1146,
      }),
  ],
];

/**
 * "The rows may well exist — I just could not see them." Each is a real class
 * the demotion must NOT reach; the last is #6347's exclusion, which carries a
 * complete missing-table phrase inside a column fault on an existing table.
 */
const STILL_LOUD: Array<[string, () => unknown]> = [
  [
    'connection refused',
    () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
  ],
  [
    'statement timeout',
    () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
  ],
  [
    'permission denied',
    () => Object.assign(new Error(`permission denied for table ${OBJECT}`), { code: '42501' }),
  ],
  [
    'connection terminated mid-query',
    () => Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' }),
  ],
  [
    '#6347 — a COLUMN of a relation that exists',
    () =>
      Object.assign(new Error(`column "label" of relation "${OBJECT}" does not exist`), {
        code: '42703',
      }),
  ],
];

/** Records every line the engine writes, per level, with its raw arg list. */
function makeCapturingLogger() {
  const lines: Record<string, Array<{ msg: string; args: any[] }>> = {
    debug: [], info: [], warn: [], error: [], trace: [], fatal: [],
  };
  const push = (level: string) => (...args: any[]) => {
    lines[level].push({ msg: String(args[0]), args: args.slice(1) });
  };
  const logger: any = {
    lines,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    trace: push('trace'),
    fatal: push('fatal'),
    child() {
      return logger;
    },
  };
  return logger;
}

/** A driver whose every verb on {@link OBJECT} throws `fault()`. */
function makeFailingDriver(fault: () => unknown) {
  return {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find() {
      throw fault();
    },
    async findOne() {
      throw fault();
    },
    async create() {
      throw fault();
    },
    async update() {
      throw fault();
    },
    async delete() {
      throw fault();
    },
    async count() {
      throw fault();
    },
    async bulkCreate() {
      throw fault();
    },
    async bulkUpdate() {
      throw fault();
    },
    async bulkDelete() {
      throw fault();
    },
    async beginTransaction() {
      return { __trx: true, commit: async () => {}, rollback: async () => {} };
    },
    async commit() {},
    async rollback() {},
  } as any;
}

describe('engine `find` failure log level is chosen by CAUSE (#13273)', () => {
  let engine: ObjectQL;
  let logger: ReturnType<typeof makeCapturingLogger>;

  async function boot(fault: () => unknown) {
    logger = makeCapturingLogger();
    engine = new ObjectQL({ logger } as any);
    engine.registerDriver(makeFailingDriver(fault), true);
    await engine.init();
    engine.registry.registerObject({
      name: OBJECT,
      fields: { label: { type: 'text' } },
    } as any);
  }

  /** Every `Find operation failed` line the run produced, keyed by level. */
  function frames() {
    return {
      error: logger.lines.error.filter((l: any) => l.msg === 'Find operation failed'),
      debug: logger.lines.debug.filter((l: any) => l.msg === 'Find operation failed'),
    };
  }

  beforeEach(() => {
    logger = makeCapturingLogger();
  });

  // ------------------------------------------------------- demoted class --

  describe('"the table was never provisioned" — demoted to `debug`, stack dropped', () => {
    for (const [label, make] of MISSING_TABLE) {
      it(`no \`error\` frame, one \`debug\` frame — ${label}`, async () => {
        await boot(() => envelope(make()));

        await expect(engine.find(OBJECT)).rejects.toThrow();

        const seen = frames();
        expect(seen.error).toHaveLength(0);
        expect(seen.debug).toHaveLength(1);
      });
    }

    it('the demoted line still carries the object, the classification and the reason', async () => {
      await boot(() => envelope(new Error(`no such table: ${OBJECT}`)));
      await expect(engine.find(OBJECT)).rejects.toThrow();

      // `debug(message, meta)` — meta is the FIRST trailing arg, and there is
      // no Error argument at all, which is how the stack leaves the record.
      const [meta] = frames().debug[0].args;
      expect(meta).toMatchObject({ object: OBJECT, reason: 'table-not-provisioned' });
      expect(String((meta as any).error)).toContain(
        `The database refused to run this query for object '${OBJECT}'`,
      );
      // ⛔ The stack is what made this record expensive to read on a command
      // that SUCCEEDS. Nothing in the demoted record carries one.
      expect(JSON.stringify(meta)).not.toContain('    at ');
    });

    it('classifies through the driver envelope, not the raw dialect error', async () => {
      // The envelope's own message says nothing about a missing table — the
      // dialect text survives only on its non-enumerable `cause`. A classifier
      // that read the top-level message would leave this at `error`, so this
      // case is what proves the `cause` walk is the one being exercised.
      await boot(() => envelope(new Error(`no such table: ${OBJECT}`)));
      await expect(engine.find(OBJECT)).rejects.toThrow();

      const [meta] = frames().debug[0].args;
      // The classification landed even though the text the classifier keys on
      // is nowhere in the message it was handed.
      expect(String((meta as any).error)).not.toContain('no such table');
      expect(frames().debug).toHaveLength(1);
      expect(frames().error).toHaveLength(0);
    });
  });

  // --------------------------------------------- positive control: loud --

  describe('⭐ positive control — a read that genuinely FAILED is still loud', () => {
    for (const [label, make] of STILL_LOUD) {
      it(`one \`error\` frame carrying the Error, no \`debug\` frame — ${label}`, async () => {
        await boot(() => envelope(make()));

        await expect(engine.find(OBJECT)).rejects.toThrow();

        const seen = frames();
        expect(seen.debug).toHaveLength(0);
        expect(seen.error).toHaveLength(1);
        // `error(message, error, meta)` — the Error object is the FIRST
        // trailing arg, which is what puts the stack in the record.
        const [err, meta] = seen.error[0].args;
        expect(err).toBeInstanceOf(Error);
        expect(typeof (err as Error).stack).toBe('string');
        expect(meta).toMatchObject({ object: OBJECT });
      });
    }

    it('an unrecognised failure is loud — a benign verdict is earned, never defaulted to', async () => {
      await boot(() => envelope(new Error('something nobody has classified yet')));
      await expect(engine.find(OBJECT)).rejects.toThrow();

      expect(frames().error).toHaveLength(1);
      expect(frames().debug).toHaveLength(0);
    });
  });

  // ------------------------------------------------ what did NOT change --

  describe('⛔ unchanged: the throw, and the write verbs', () => {
    it('rethrows the driver envelope on BOTH branches, unmodified', async () => {
      await boot(() => envelope(new Error(`no such table: ${OBJECT}`)));
      await expect(engine.find(OBJECT)).rejects.toThrow(
        /The database refused to run this query/,
      );

      await boot(() => envelope(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })));
      await expect(engine.find(OBJECT)).rejects.toThrow(
        /The database refused to run this query/,
      );
    });

    it('a WRITE to a table that does not exist is still `error`', async () => {
      // Nothing landed, and the row the caller believes it stored is gone —
      // never a normal answer, whatever the cause.
      await boot(() => envelope(new Error(`no such table: ${OBJECT}`)));

      await expect(engine.insert(OBJECT, { label: 'x' } as any)).rejects.toThrow();

      const insertFrames = logger.lines.error.filter(
        (l: any) => l.msg === 'Insert operation failed',
      );
      expect(insertFrames).toHaveLength(1);
      expect(logger.lines.debug.filter((l: any) => l.msg === 'Insert operation failed')).toHaveLength(0);
    });
  });
});
