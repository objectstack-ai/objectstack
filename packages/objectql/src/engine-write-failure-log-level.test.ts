// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17052 — the three write doors report a REFUSED write at `warn`, not `error`,
// because each of their catches rethrows.
//
// ## The rule, and why this shape is not a degradation at all
//
// AGENTS.md → *Degradation log levels — `warn` vs `error`*: an `error` is owed
// when the system "still looks normal from the outside, while something it
// claims is persisted has not actually landed". Then, verbatim:
//
//   > And a failure handed to the CALLER is not a degradation at all — the
//   > third legal answer … does not look normal from the outside — the
//   > requester was told. Do not bolt a `logger.error` onto such a site.
//
// `insert` / `update` / `delete` each end their catch with `throw e`. The
// requester is told, by the loudest means available, on every path out.
//
// ## What it cost while the level said otherwise
//
// `@better-auth/oauth-provider` seeds `sys_oauth_resource` in `insertOnly` mode
// and documents the `identifier` UNIQUE constraint AS its race-safety
// mechanism: one boot wins, the other catches the constraint error and treats
// it as a no-op, logging the collision at `debug`. Our line was emitted before
// that catch ever ran, so a completely healthy first boot of every fresh
// project printed `ERROR Insert operation failed`, which red-lit
// `publish-smoke / packed-tarballs` for six consecutive runs on a candidate
// whose probes were all green.
//
// ## ⛔ What must NOT move with the level (the two earlier rulings)
//
//   - #8682 — the bound statement and its values are cut from BOTH `message`
//     and `stack`; what the database itself said is kept.
//   - #14095 — the entry carries the driver's error (a `DuplicateRecordError`'s
//     `cause`), never the envelope, because the platform logger serializes only
//     `message` and `stack` and the envelope would drop the failing column,
//     MySQL's index name and the driver's own frames.
//
// Both are pinned in their own suites (`driver-fault-redaction.test.ts`,
// `engine-update-duplicate-record.test.ts`). What is pinned HERE is the fact
// that made them survivable at all: `warn(message, meta?)` has no `Error` slot,
// so the engine rebuilds the exact `{ error: { message, stack } }` bag the slot
// used to build. Handing the Error over as meta instead would have serialized
// `{}` — `Error.message` and `Error.stack` are non-enumerable — and the
// diagnosis would have been destroyed one level down rather than kept.

import { describe, it, expect } from 'vitest';
import { createLogger } from '@objectstack/core';
import { ObjectQL } from './engine.js';

const OBJECT = 'doc';

/** A driver that refuses every write with the fault under test. */
function refusingDriver(makeFault: () => Error) {
  const reject = async () => { throw makeFault(); };
  return {
    name: 'refusing',
    async connect() {}, async disconnect() {},
    async find() { return []; },
    async findOne() { return { id: 'r1', title: 't' }; },
    async count() { return 1; },
    async create() { return reject(); },
    async update() { return reject(); },
    async updateMany() { return reject(); },
    async delete() { return reject(); },
    async deleteMany() { return reject(); },
    async bulkCreate() { return reject(); },
    async syncSchema() {}, async initObjects() {},
  } as any;
}

/** A sqlite-shaped unique violation with the statement inlined, knex style. */
const uniqueViolation = () =>
  new Error(
    "insert into `doc` (`id`, `identifier`) values ('r1', 'urn:secret-canary') " +
      '- UNIQUE constraint failed: doc.identifier',
  );

function makeCapturingLogger() {
  const lines: Array<{ level: string; msg: string; a?: any; b?: any }> = [];
  const push = (level: string) => (msg: string, a?: any, b?: any) =>
    void lines.push({ level, msg: String(msg), a, b });
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug: push('debug'), info: push('info'),
    warn: push('warn'), error: push('error'),
    child() { return logger; },
  };
  return logger;
}

async function bootEngine(logger: any) {
  const engine = new ObjectQL({ logger });
  engine.registerDriver(refusingDriver(uniqueViolation), true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT,
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
      identifier: { name: 'identifier', type: 'text' },
    },
  } as any, 'test');
  return engine;
}

/** Run one write door and hand back every line it wrote. */
async function refuse(run: (e: ObjectQL) => Promise<unknown>) {
  const logger = makeCapturingLogger();
  const engine = await bootEngine(logger);
  let thrown: unknown = null;
  try { await run(engine); } catch (e) { thrown = e; }
  return { thrown, lines: logger.lines as Array<{ level: string; msg: string; a?: any; b?: any }> };
}

const DOORS: ReadonlyArray<readonly [string, string, (e: ObjectQL) => Promise<unknown>]> = [
  ['insert', 'Insert operation failed', (e) => e.insert(OBJECT, { identifier: 'urn:x' } as any)],
  ['update', 'Update operation failed', (e) => e.update(OBJECT, { id: 'r1', identifier: 'urn:x' } as any)],
  // `delete(object, options)` — the record is addressed through `where`; the
  // engine rejects an unknown `id` key outright (#4371), which is how this
  // spelling was measured rather than guessed.
  ['delete', 'Delete operation failed', (e) => e.delete(OBJECT, { where: { id: 'r1' } } as any)],
];

describe('#17052 — a refused write is reported at `warn`, and the caller is told', () => {
  for (const [door, msg, run] of DOORS) {
    describe(`${door}()`, () => {
      it('reports once, at `warn`, and emits NOTHING at `error`', async () => {
        const { lines } = await refuse(run);

        const entries = lines.filter((l) => l.msg === msg);
        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe('warn');
        // ⭐ The publish-smoke boot scan reads the LEVEL, not the message
        // (`SMOKE_ERROR_LOG_PATTERN` in scripts/publish-smoke.sh). Nothing this
        // door writes may land on that channel while the caller is being told.
        expect(lines.filter((l) => l.level === 'error')).toEqual([]);
      });

      it('⭐ the failure is DELIVERED — the rethrow is what makes `warn` legal', async () => {
        const { thrown } = await refuse(run);
        // Every path out of the catch is the rethrow; if this ever stops being
        // true the level argument collapses and the entry owes `error` again.
        expect(thrown).toBeInstanceOf(Error);
      });

      it('keeps the diagnosis: the database`s own words, with the values cut', async () => {
        const { lines } = await refuse(run);
        const entry = lines.find((l) => l.msg === msg)!;
        // `warn(message, meta)` — the meta is the SECOND argument, and the
        // driver's two serializable fields are rebuilt inside it.
        const meta = entry.a as { object: string; error: { message: string; stack: string } };

        expect(meta.object).toBe(OBJECT);
        // #8682 — kept: what the database said. Cut: the statement and values.
        expect(meta.error.message).toContain('UNIQUE constraint failed: doc.identifier');
        expect(meta.error.message).not.toContain('urn:secret-canary');
        expect(meta.error.message).not.toContain('insert into');
        expect(meta.error.stack).not.toContain('urn:secret-canary');
      });
    });
  }

  it('⭐ the rendered line is unchanged apart from the level word', async () => {
    // The strongest form of "the diagnosis survived": run the REAL platform
    // logger and compare what it prints against what it printed before, which
    // is reconstructed here by calling `error` with the same payload through
    // the slot the door used to use. Everything but the level must match —
    // same message, same meta keys in the same order, same redacted text.
    const written: string[] = [];
    const sink = { write: (s: string) => void written.push(s) };
    const capture = (fn: () => void) => {
      written.length = 0;
      const original = process.stdout.write.bind(process.stdout);
      const originalErr = process.stderr.write.bind(process.stderr);
      (process.stdout as any).write = sink.write;
      (process.stderr as any).write = sink.write;
      try { fn(); } finally {
        (process.stdout as any).write = original;
        (process.stderr as any).write = originalErr;
      }
      return written.join('');
    };

    const logger = createLogger({ level: 'info', format: 'pretty' });
    const driverError = new Error('UNIQUE constraint failed: doc.identifier');
    driverError.stack = 'Error: UNIQUE constraint failed: doc.identifier\n    at Database.prepare';
    const meta = { object: OBJECT, error: { message: driverError.message, stack: driverError.stack } };

    const nowLine = capture(() => logger.warn('Insert operation failed', meta));
    const beforeLine = capture(() =>
      logger.error('Insert operation failed', driverError, { object: OBJECT }),
    );

    // Strip the leading ISO timestamp and the level word; the remainder — the
    // message and the whole serialized context — must be byte-identical.
    const tail = (l: string) => l.replace(/^\S+Z (WARN|ERROR) /, '');
    expect(tail(nowLine)).toBe(tail(beforeLine));
    expect(nowLine).toMatch(/^\S+Z WARN /);
    expect(beforeLine).toMatch(/^\S+Z ERROR /);
  });
});
