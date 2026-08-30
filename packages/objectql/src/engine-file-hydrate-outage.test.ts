// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6116 — a `sys_file` hydrate READ FAULT must not be indistinguishable from
 * "this record has no file".
 *
 * `resolveFileReferences` enriches a file-field value stored as an opaque
 * `sys_file` id into `{ id, name, size, mimeType, url }` (ADR-0104 D3 wave 2).
 * Its one batched lookup used to sit behind a bare `} catch { return records }`:
 * EVERY failure — connection drop, timeout, permission denial, query error, and
 * the benign "the table was never provisioned" — was answered with the same
 * silent pass-through of un-hydrated ids.
 *
 * ONE CORRECTION to the issue body, measured rather than assumed: the catch is
 * zero-output, but the PATH is not literally silent. The generic read handler
 * one frame up already logs `'Find operation failed' { object: 'sys_file' }`
 * before rethrowing into this catch. That line is untouched here, and the
 * `the generic line separates the two causes but still cannot name the loss`
 * block below pins why it does not satisfy the acceptance: it describes the
 * sub-read only — never the parent object, the fields left un-hydrated, or the
 * consequence. ⚠️ [#13273] That block was rewritten when the generic frame
 * stopped being `error` for every cause: it is `debug` for the benign
 * "table was never provisioned" class now, and `error` for everything else.
 * The consequence gap this file exists to close is unchanged either way.
 *
 * The pass-through itself is correct and is NOT what this fixes. A file-metadata
 * read that fails must not take down the record read that asked for it, so
 * **fail-open is deliberate and unchanged** — the tests below pin it on both
 * branches precisely so a future reader cannot mistake this for a behaviour
 * change. What was wrong is that the degradation was INVISIBLE: consumers
 * (UI, export) receive a bare id, render it as "no attachment", and the outage
 * is indistinguishable from a record that genuinely holds no file. That is the
 * ADR-0110 D3 family — a fault wearing the appearance of legitimate absent data
 * — carried on a functional surface rather than a durability one.
 *
 * The fix discriminates by error TYPE through the shared `isMissingTableError`
 * predicate (`@objectstack/metadata/errors`, #4825) — the same call
 * `seedAutonumber` makes in this file (#5979) — never a hand-rolled
 * `code === '42P01'` copy:
 *
 *   - table never provisioned → pass ids through in silence (there are
 *     genuinely no committed rows, so the un-hydrated answer IS the truth);
 *   - every other read failure → ONE `warn` naming the object, the fields, the
 *     consequence and the fix, then pass the ids through anyway.
 *
 * `warn` and not `error`, per AGENTS "Degradation log levels": nothing on this
 * path claims to have persisted anything, the answer is visibly smaller for
 * this response only, and the next read repairs it — functional degradation.
 *
 * Why the gate never caught it (#5186's read-seam invention rule): that rule
 * matches a catch that RETURNS AN EMPTY LITERAL (`[]`/`null`/`0`/…) for a read
 * that failed. Returning the input argument unchanged is outside its
 * vocabulary — see the PR for the stance on whether it should grow.
 *
 * These tests drive a fake DRIVER (not a fake engine), so no engine write-verb
 * dispatch contract is involved.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine';

/** The stored form: an opaque `sys_file` id token, per `isFileIdToken`. */
const FILE_ID = 'f_7cQx2Lm90a';

/**
 * A driver whose `sys_file` read behaves as `sysFileRead` says, while every
 * other object reads normally out of an in-memory store. Splitting by object
 * name is the whole point: the RECORD read must succeed so the test observes
 * what the caller receives for a record that really does hold a file.
 */
function makeDriver(sysFileRead: () => Promise<any[]>) {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (object: string) => {
    if (!stores.has(object)) stores.set(object, new Map());
    return stores.get(object)!;
  };
  const driver: any = {
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
    async find(object: string) {
      if (object === 'sys_file') return sysFileRead();
      return [...storeFor(object).values()];
    },
    async findOne(object: string) {
      if (object === 'sys_file') {
        const rows = await sysFileRead();
        return rows[0] ?? null;
      }
      return [...storeFor(object).values()][0] ?? null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${storeFor(object).size + 1}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(object).get(id), ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async delete(object: string, id: string) {
      return storeFor(object).delete(id);
    },
    async count() {
      return 0;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {},
    async beginTransaction() {
      return { __trx: true, commit: async () => {}, rollback: async () => {} };
    },
    async commit() {},
    async rollback() {},
  };
  return { driver, storeFor };
}

/**
 * Records every line the engine writes, per level, for the log-contract pins.
 *
 * Captures the raw arg list because the two levels this file asserts on have
 * DIFFERENT signatures in `Logger` (`warn(msg, meta)` vs
 * `error(msg, error, meta)`); collapsing them to `(msg, meta)` reads the Error
 * object as the metadata and quietly mis-asserts.
 */
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

/** The `warn` contract is `(message, meta)` — meta is the FIRST trailing arg. */
const metaOfWarn = (line: { args: any[] }) => line.args[0];

/** Driver-shaped errors meaning "the table was never provisioned" (benign). */
const MISSING_TABLE_ERRORS: Array<[string, () => unknown]> = [
  ['PostgreSQL 42P01 undefined_table', () => Object.assign(new Error('relation "sys_file" does not exist'), { code: '42P01' })],
  ['MySQL ER_NO_SUCH_TABLE', () => Object.assign(new Error("Table 'app.sys_file' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 })],
  ['SQLite message-only', () => new Error('no such table: sys_file')],
];

/**
 * Driver-shaped errors meaning "the rows may well exist — I just could not see
 * them". Each is a real outage class the old bare catch answered with silence.
 */
const OUTAGE_ERRORS: Array<[string, () => unknown]> = [
  ['connection refused', () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
  ['statement timeout', () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })],
  ['permission denied', () => Object.assign(new Error('permission denied for table sys_file'), { code: '42501' })],
  ['connection terminated mid-query', () => Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' })],
];

describe('sys_file hydrate read fault — distinguishable from "no file" (#6116)', () => {
  let engine: ObjectQL;
  let logger: ReturnType<typeof makeCapturingLogger>;

  /**
   * Boots an engine holding ONE `doc` row whose `attachment` field carries a
   * stored `sys_file` id, with the `sys_file` read wired to `sysFileRead`.
   */
  async function boot(sysFileRead: () => Promise<any[]>) {
    logger = makeCapturingLogger();
    engine = new ObjectQL({ logger } as any);
    const { driver, storeFor } = makeDriver(sysFileRead);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'doc',
      fields: {
        title: { type: 'text' },
        attachment: { type: 'file' },
      },
    } as any);
    // `sys_file` must be REGISTERED — the resolver skips without a failing
    // query when the storage plugin is absent, which is a different branch.
    engine.registry.registerObject({
      name: 'sys_file',
      fields: {
        name: { type: 'text' },
        size: { type: 'number' },
        mime_type: { type: 'text' },
        status: { type: 'text' },
      },
    } as any);
    storeFor('doc').set('d1', { id: 'd1', title: 'Contract', attachment: FILE_ID });
    return { driver, storeFor };
  }

  beforeEach(() => {
    logger = makeCapturingLogger();
  });

  // -------------------------------------------------- fail-open, both sides --

  describe('fail-open is UNCHANGED — ids pass through on every failure', () => {
    for (const [label, make] of [...MISSING_TABLE_ERRORS, ...OUTAGE_ERRORS]) {
      it(`returns the records with raw ids, never throws — ${label}`, async () => {
        await boot(async () => {
          throw make();
        });

        const rows = await engine.find('doc');

        // The read that ASKED for the file still answers. This is the pin that
        // makes #6116 a diagnosability fix and not a behaviour change: if a
        // later change turns this seam into a throw, this goes red.
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('Contract');
        expect(rows[0].attachment).toBe(FILE_ID);
      });
    }

    it('findOne fails open on the same seam', async () => {
      await boot(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      });

      const row = await engine.findOne('doc', { where: { id: 'd1' } });

      expect(row?.attachment).toBe(FILE_ID);
    });
  });

  // ---------------------------------------------------------------- benign --

  describe('table not provisioned → silent pass-through (benign, unchanged)', () => {
    for (const [label, make] of MISSING_TABLE_ERRORS) {
      it(`adds no line of its own — ${label}`, async () => {
        await boot(async () => {
          throw make();
        });

        await engine.find('doc');

        // There are genuinely no committed rows, so the un-hydrated answer IS
        // the truth and there is nothing to report. Reporting it anyway would
        // fire on every read of an app whose storage schema is not synced —
        // the noise that makes real lines unreadable.
        expect(logger.lines.warn).toHaveLength(0);
        expect(logger.lines.fatal).toHaveLength(0);
      });
    }
  });

  // ------------------------------------------- why a new line was needed --

  /**
   * The pre-existing signal, measured — and why it does not satisfy the
   * acceptance on its own.
   *
   * #6116's body says the seam logs nothing. Measured on `origin/main` that is
   * true of the CATCH, but not of the whole path: the generic read handler one
   * frame up (`engine.ts`, `'Find operation failed'`) already reports the
   * failed `sys_file` sub-read before rethrowing into this catch. That line is
   * real and this fix neither removes nor duplicates it.
   *
   * ⚠️ [#13273] What HAS moved since #6116, and why this block was rewritten
   * rather than deleted. That generic frame used to be `error` for every cause
   * — which is what made it useless as a discriminator, and is the sentence
   * this block used to pin. `engine.ts` now asks `isMissingTableError` and puts
   * the benign class on `debug`, so the two causes no longer produce the same
   * line. The re-pinned facts below are therefore:
   *
   *   1. the generic frame DOES now separate the two causes by channel — the
   *      benign read leaves the `error` channel empty (#13273's own acceptance,
   *      re-measured from this file's fake driver);
   *   2. and it STILL does not satisfy #6116's acceptance, because on the
   *      outage branch it describes the sub-read only — never the parent
   *      object, the fields left un-hydrated, or the consequence that those
   *      bare ids will read downstream as "this record has no file". That gap
   *      is what the seam's own `warn` closes, and it is unchanged.
   */
  describe('the generic line separates the two causes but still cannot name the loss', () => {
    async function errorCensus(make: () => unknown) {
      await boot(async () => {
        throw make();
      });
      await engine.find('doc');
      return logger.lines.error.map((l: any) => l.msg);
    }

    async function debugCensus(make: () => unknown) {
      await boot(async () => {
        throw make();
      });
      await engine.find('doc');
      return logger.lines.debug.map((l: any) => l.msg);
    }

    it('[#13273] the benign cause no longer reaches `error` — it reaches `debug`', async () => {
      const benign = await errorCensus(() => new Error('no such table: sys_file'));
      const outage = await errorCensus(() =>
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }));

      // "The table was never provisioned" is a routine state, not a failure to
      // report — and every caller on that path treats it as a normal answer.
      expect(benign).toEqual([]);
      // ⭐ The positive control on that zero: the SAME read, one cause over,
      // still reaches `error`. So the empty census above measures the
      // classification and not a broken fixture.
      expect(outage).toEqual(['Find operation failed']);
    });

    it('[#13273] the benign frame is still recorded, one channel down', async () => {
      // ⛔ Demoted, not muted: the frame is still emitted, still names the
      // object, and now carries its own classification instead of a stack.
      const benign = await debugCensus(() => new Error('no such table: sys_file'));
      expect(benign).toEqual(['Find operation failed']);

      const [meta] = logger.lines.debug[0].args;
      expect(meta).toMatchObject({ object: 'sys_file', reason: 'table-not-provisioned' });
    });

    it('names only the sub-read, not the degradation it caused', async () => {
      await boot(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      });

      await engine.find('doc');

      // `error(message, error, meta)` — the meta says which object was read…
      const [, meta] = logger.lines.error[0].args;
      expect(meta).toMatchObject({ object: 'sys_file' });
      // …and nothing about `doc`, `attachment`, or the un-hydrated answer that
      // was nevertheless returned to the caller. That gap is this issue.
      expect(JSON.stringify(meta)).not.toMatch(/doc|attachment/);
    });
  });

  // ---------------------------------------------------------------- outage --

  describe('read outage → exactly one `warn` that names the loss', () => {
    for (const [label, make] of OUTAGE_ERRORS) {
      it(`warns exactly once — ${label}`, async () => {
        await boot(async () => {
          throw make();
        });

        await engine.find('doc');

        expect(logger.lines.warn).toHaveLength(1);
        // Functional degradation, not durability: nothing here claims to have
        // persisted anything, so escalating to `error` would be the
        // mirror-image failure AGENTS "Degradation log levels" warns about.
        // The seam adds no loud line of its own — the single `error` present
        // is the generic read handler's, pinned in its own block above.
        expect(logger.lines.error).toHaveLength(1);
        expect(logger.lines.error[0].msg).toBe('Find operation failed');
        expect(logger.lines.fatal).toHaveLength(0);
      });
    }

    it('the line carries what a reader needs: object, fields, consequence, fix', async () => {
      await boot(async () => {
        throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      });

      await engine.find('doc');

      const [line] = logger.lines.warn;
      // The CONSEQUENCE, spelled out — this is the whole point of the issue:
      // the reader must learn that bare ids will read as "no file".
      expect(line.msg).toMatch(/sys_file/);
      expect(line.msg).toMatch(/no file/i);
      // …and the FIX, so the line is actionable rather than a bare complaint.
      expect(line.msg).toMatch(/availability/i);
      // The locus the generic line above cannot give: which PARENT object and
      // which fields were left un-hydrated, and how many ids went unresolved.
      expect(metaOfWarn(line)).toMatchObject({ object: 'doc', fields: ['attachment'], unresolvedIds: 1 });
      // The driver's own diagnosis, not a synthesized one.
      expect(String(metaOfWarn(line).error)).toMatch(/statement timeout/);
    });

    it('says it ONCE per read, not once per record or per id', async () => {
      const { storeFor } = await boot(async () => {
        throw Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' });
      });
      storeFor('doc').set('d2', { id: 'd2', title: 'Invoice', attachment: 'f_zz11yy22xx' });
      storeFor('doc').set('d3', { id: 'd3', title: 'Receipt', attachment: 'f_aa33bb44cc' });

      const rows = await engine.find('doc');

      expect(rows).toHaveLength(3);
      // One batched lookup fails once, so it is reported once — AGENTS: "Say it
      // once, at the first degradation, not once per failed write."
      expect(logger.lines.warn).toHaveLength(1);
      expect(metaOfWarn(logger.lines.warn[0])).toMatchObject({ unresolvedIds: 3 });
    });
  });

  // ----------------------------------------------------------- no false red --

  describe('the healthy path stays silent', () => {
    it('hydrates and logs nothing when the lookup succeeds', async () => {
      await boot(async () => [
        { id: FILE_ID, name: 'contract.pdf', size: 1024, mime_type: 'application/pdf', status: 'committed' },
      ]);

      const rows = await engine.find('doc');

      expect(rows[0].attachment).toMatchObject({
        id: FILE_ID,
        name: 'contract.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      });
      expect(logger.lines.warn).toHaveLength(0);
    });

    it('an id with no committed row is a MISS, not a fault — still silent', async () => {
      await boot(async () => []);

      const rows = await engine.find('doc');

      // A clean miss (the read happened, nothing matched) is legitimate absent
      // data — exactly the fact the outage branch must not be confused with.
      // It keeps the raw id and stays quiet.
      expect(rows[0].attachment).toBe(FILE_ID);
      expect(logger.lines.warn).toHaveLength(0);
    });
  });
});
