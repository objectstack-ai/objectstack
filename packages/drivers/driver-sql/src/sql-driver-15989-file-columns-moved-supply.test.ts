// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The kernel→driver supply seam for the ADR-0104 media arm, from the
 * DRIVER's side — and the property the whole mechanism rests on:
 *
 * > ⭐ **Every way of not knowing answers "not moved".**
 *
 * The engine's half (`ObjectQL.registerDriver` handing over a closure over
 * `sys_migration.columns_moved_at`) is pinned in `@objectstack/objectql`. This
 * file pins what the driver does with it, because the driver is where the
 * consequence lands: a driver that guessed "moved" writes bare ids into a JSON
 * column, on a deployment nobody migrated.
 *
 * ⛔ The reason absence must be the JSON arm is not caution in the abstract.
 * Every deployment that exists today is on the JSON encoding, and a host that
 * has simply not been threaded this option is indistinguishable from one whose
 * deployment has not moved — so those two must give the same answer, and the
 * answer has to be the one that is true of every store in the world.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './sql-driver.js';
import type { SqlDriverConfig } from './sql-driver.js';

const SQLITE: SqlDriverConfig = {
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
} as SqlDriverConfig;

/** Reads the arm the way every writer and every DDL branch reads it. */
class ArmProbe extends SqlDriver {
  get arm(): boolean {
    return (this as unknown as { fileColumnsMoved: boolean }).fileColumnsMoved;
  }
  askedJson(type = 'image'): boolean {
    return this.isJsonField(type, { type });
  }
}

const open: ArmProbe[] = [];
function driver(config: Partial<SqlDriverConfig> = {}): ArmProbe {
  const d = new ArmProbe({ ...SQLITE, ...config } as SqlDriverConfig);
  open.push(d);
  return d;
}

afterEach(async () => {
  while (open.length) await open.pop()?.disconnect().catch(() => {});
});

const OBJ = [{ name: 'os15989s_t', fields: { cover: { type: 'image' }, label: { type: 'string' } } }] as any;

describe('#15989 — every way of NOT KNOWING answers "not moved"', () => {
  it('① the option is OMITTED and nothing supplies one', async () => {
    const d = driver();
    await d.initObjects(OBJ);
    expect(d.arm).toBe(false);
    expect(d.askedJson()).toBe(true);
  });

  it('② a resolver that THROWS synchronously', async () => {
    const d = driver({ fileColumnsMoved: () => { throw new Error('sys_migration is not registered'); } });
    await d.initObjects(OBJ);
    expect(d.arm).toBe(false);
    expect(d.askedJson()).toBe(true);
  });

  it('③ a resolver that REJECTS', async () => {
    const d = driver({ fileColumnsMoved: async () => { throw new Error('relation does not exist'); } });
    await d.initObjects(OBJ);
    expect(d.arm).toBe(false);
  });

  it('④ a resolver that answers something that is not `true`', async () => {
    // The ledger's own absent-stamp shape reaches a duck-typed resolver as
    // `null`/`undefined` more easily than as `false`, so the driver tests for
    // `=== true` rather than for falsiness.
    for (const answer of [undefined, null, 0, '', 'true', {}]) {
      const d = driver({ fileColumnsMoved: (() => answer) as never });
      await d.initObjects(OBJ);
      expect(d.arm, JSON.stringify(answer)).toBe(false);
    }
  });

  it('⑤ a resolver that NEVER RUNS — the host never calls initObjects', async () => {
    let asked = false;
    const d = driver({ fileColumnsMoved: () => { asked = true; return true; } });
    // `registerObjectMetadata` is the `skipSchemaSync` / registration-only
    // posture: no schema sync, so no `initObjects`, so nothing resolves.
    (d as unknown as { registerObjectMetadata: (o: unknown) => void }).registerObjectMetadata(OBJ);
    expect(asked, 'nothing may ask the ledger outside initObjects').toBe(false);
    expect(d.arm).toBe(false);
    expect(d.askedJson()).toBe(true);
  });

  it('⑥ …and a resolver that answers `true` DOES move the arm — the control', async () => {
    // ⛔ Without this every case above passes on a driver whose arm is welded
    // shut, and the file measures nothing.
    const d = driver({ fileColumnsMoved: async () => true });
    await d.initObjects(OBJ);
    expect(d.arm).toBe(true);
    expect(d.askedJson()).toBe(false);
  });
});

describe('#15989 — setFileColumnsMovedResolver: the engine fills an EMPTY slot only', () => {
  it('takes the resolver when the host declared nothing', async () => {
    const d = driver();
    expect(d.setFileColumnsMovedResolver(async () => true)).toBe(true);
    await d.initObjects(OBJ);
    expect(d.arm).toBe(true);
  });

  it('⛔ REFUSES to overrule a host that declared `false`', async () => {
    // The dangerous direction: the engine turning a declared "not moved" into
    // "moved" writes bare ids into a JSON column. A host that names the option
    // is asserting something about its own storage, and the engine does not
    // contradict it.
    const d = driver({ fileColumnsMoved: false });
    expect(d.setFileColumnsMovedResolver(async () => true)).toBe(false);
    await d.initObjects(OBJ);
    expect(d.arm).toBe(false);
  });

  it('⛔ REFUSES to overrule a host that declared `true` either', async () => {
    // Symmetric, and refused for the same reason rather than for the opposite
    // one: the host is the more specific authority. Overruling this direction
    // would have a driver write JSON into columns already retyped.
    const d = driver({ fileColumnsMoved: true });
    expect(d.setFileColumnsMovedResolver(async () => false)).toBe(false);
    await d.initObjects(OBJ);
    expect(d.arm).toBe(true);
  });

  it('⛔ REFUSES to overrule a resolver the host supplied itself', async () => {
    const d = driver({ fileColumnsMoved: async () => true });
    expect(d.setFileColumnsMovedResolver(async () => false)).toBe(false);
    await d.initObjects(OBJ);
    expect(d.arm).toBe(true);
  });

  it('⛔ REFUSES after the arm has already been asked and frozen', async () => {
    // `registerObjectMetadata` freezes `isJsonField`'s answer into `jsonFields`
    // for every media column, so a resolver arriving after the first
    // `initObjects` is a promise the driver cannot keep: it would change the
    // write encoding of a table whose columns were built for the other one.
    const d = driver();
    await d.initObjects(OBJ);
    expect(d.arm).toBe(false);
    expect(d.setFileColumnsMovedResolver(async () => true)).toBe(false);
    await d.initObjects(OBJ);
    expect(d.arm).toBe(false);
  });
});

describe('#15989 — the resolver is asked ONCE', () => {
  it('a repeat initObjects finds nothing left to ask', async () => {
    let calls = 0;
    const d = driver({
      fileColumnsMoved: async () => {
        calls += 1;
        return true;
      },
    });
    await d.initObjects(OBJ);
    await d.initObjects(OBJ);
    await d.initObjects([{ name: 'os15989s_t2', fields: { cover: { type: 'image' } } }] as any);
    expect(calls, 'the batched and deferred-DDL paths both call initObjects more than once').toBe(1);
    expect(d.arm).toBe(true);
  });
});
