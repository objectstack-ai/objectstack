// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4632 — a failed schema sync is a DURABILITY degradation, so it is reported
// at `error`, not `warn`.
//
// #4420 is the accident that made this a rule: a store attached to a table that
// was never created, every write failing into a `warn` nobody read, every
// restart dropping all in-flight approvals — while the system reported itself
// healthy the entire time. #4460 fixed that one site; the schema-sync path
// below is the same shape one layer up, and it is the path that DECIDES whether
// a table exists at all. These tests pin the level and the two things the
// message owes the reader: the CONSEQUENCE and the FIX.

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  /**
   * Everything after the message. The two loggers in play take DIFFERENT
   * shapes — the engine's is `(msg, Error, context)` while `PluginContext`'s is
   * `(msg, context)` — so the recorder keeps the raw tail and each assertion
   * says which one it means. (Collapsing them into a single `meta` is what let
   * a `{ object: … }` land in the engine's `Error` slot and turn the DTS build
   * red while every runtime test stayed green.)
   */
  args: unknown[];
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, ...args: unknown[]) =>
    void records.push({ level, message: String(message), args });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
}

/** Flatten a record's tail args to text, Error messages included. */
function tailText(r: Recorded): string {
  return r.args
    .map((a) => (a instanceof Error ? a.message : JSON.stringify(a)))
    .join(' ');
}

/** A driver whose DDL always fails — the whole point of these tests. */
function failingDriver(name: string, message: string) {
  return {
    name,
    supports: {},
    async syncSchema() {
      throw new Error(message);
    },
    async find() {
      return [];
    },
  };
}

describe('ObjectQL.syncSchemas() — DDL failure is an error, not a silent swallow (#4632)', () => {
  it('reports a failed syncSchema at error, naming the consequence and the fix', async () => {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver(failingDriver('default', 'no such column: status') as any);
    engine.registerObject({
      name: 'invoice',
      label: 'Invoice',
      fields: { id: { type: 'text' }, status: { type: 'text' } },
    } as any);

    await engine.syncSchemas();

    const errors = rec.at('error');
    expect(errors).toHaveLength(1);
    // CONSEQUENCE: the reader must learn the table is not there and that writes
    // are not durable — not merely that "something failed".
    expect(errors[0].message).toContain("'invoice'");
    expect(errors[0].message).toMatch(/NOT created or altered/);
    expect(errors[0].message).toMatch(/not durable/);
    // FIX: what to actually do about it.
    expect(errors[0].message).toMatch(/re-run the install\/sync/);
    // The driver's own error is preserved for diagnosis, and — the part CI
    // caught — it goes in the engine logger's `Error` slot, with the structured
    // context in the third argument where it type-checks.
    expect(errors[0].args[0]).toBeInstanceOf(Error);
    expect((errors[0].args[0] as Error).message).toContain('no such column: status');
    expect(errors[0].args[1]).toMatchObject({ object: 'invoice' });
  });

  it('does not hide the failure at warn/debug — the level is the whole point', async () => {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver(failingDriver('default', 'boom') as any);
    engine.registerObject({ name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } });

    await engine.syncSchemas();

    // Before #4632 this catch was empty with the comment "log suppressed to
    // avoid noise on already-synced tables" — zero output on a lost DDL.
    expect(rec.at('error').length).toBeGreaterThan(0);
    expect(rec.at('warn').filter((r) => /sync/i.test(r.message))).toHaveLength(0);
  });

  it('stays silent when DDL succeeds — the rule must not create noise', async () => {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver({
      name: 'default',
      supports: {},
      async syncSchema() {
        /* succeeds */
      },
      async find() {
        return [];
      },
    } as any);
    engine.registerObject({ name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } });

    await engine.syncSchemas();

    expect(rec.at('error')).toHaveLength(0);
  });
});

describe('ObjectQLPlugin.syncRegisteredSchemas() — per-object and summary levels (#4632)', () => {
  /** Drive the private sync pass directly: the level is the unit under test. */
  async function runSync(driver: unknown, objects: Array<ServiceObject>) {
    const rec = recordingLogger();
    const plugin = new ObjectQLPlugin();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver(driver as any);
    for (const obj of objects) engine.registerObject(obj);
    (plugin as any).ql = engine;
    await (plugin as any).syncRegisteredSchemas({ logger: rec.logger });
    return rec;
  }

  it('reports each failed object at error with the consequence and the opt-out', async () => {
    const rec = await runSync(failingDriver('default', 'permission denied for schema public'), [
      { name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } },
    ]);

    const perObject = rec.at('error').find((r) => r.message.includes("'invoice'"));
    expect(perObject).toBeDefined();
    expect(perObject!.message).toMatch(/NOT created or altered/);
    expect(perObject!.message).toMatch(/stays\s+registered and served/);
    // The FIX includes the DELIBERATE opt-out, so a host that manages DDL
    // out-of-band can make the omission explicit instead of living with an error.
    expect(perObject!.message).toMatch(/OS_SKIP_SCHEMA_SYNC/);
    // `Logger.error` is `(message, error?, meta?)` on BOTH loggers — the Error
    // in slot 2, the context bag in slot 3. (`warn` puts context in slot 2,
    // which is exactly the asymmetry that made a mechanical warn→error swap
    // compile-fail in the DTS build while every runtime assertion stayed green.)
    expect(perObject!.args[0]).toBeInstanceOf(Error);
    expect(tailText(perObject!)).toContain('permission denied for schema public');
    expect(perObject!.args[1]).toMatchObject({ object: 'invoice' });
  });

  it('never logs "Schema sync complete" at info over a pass that lost DDL', async () => {
    const rec = await runSync(failingDriver('default', 'boom'), [
      { name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } },
      { name: 'payment', label: 'Payment', fields: { id: { type: 'text' } } },
    ]);

    // The "looks normal" half of #4420: the old code printed `info: Schema sync
    // complete` after any number of failures.
    expect(rec.at('info').filter((r) => /complete/i.test(r.message))).toHaveLength(0);

    const summary = rec.at('error').find((r) => /finished with/.test(r.message));
    expect(summary).toBeDefined();
    expect(summary!.message).toContain('2 FAILED');
    // No single Error owns a whole-pass summary, so slot 2 is `undefined` and
    // the counts ride in slot 3.
    expect(summary!.args[0]).toBeUndefined();
    expect(summary!.args[1]).toMatchObject({ failed: 2, synced: 0 });
  });

  it('still says "complete" at info when every object synced', async () => {
    const rec = await runSync(
      {
        name: 'default',
        supports: {},
        async syncSchema() {
          /* succeeds */
        },
        async find() {
          return [];
        },
      },
      [{ name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } }],
    );

    expect(rec.at('error')).toHaveLength(0);
    expect(rec.at('info').some((r) => /Schema sync complete/.test(r.message))).toBe(true);
  });

  it('keeps the batch→sequential fallback at warn — it RECOVERS, so it is not a loss', async () => {
    // The rule cuts both ways: escalating a degradation that costs nothing is
    // the mirror-image failure, and it is what makes `error` unreadable.
    let batchCalls = 0;
    const rec = await runSync(
      {
        name: 'default',
        supports: { batchSchemaSync: true },
        async syncSchemasBatch() {
          batchCalls++;
          throw new Error('batch endpoint unavailable');
        },
        async syncSchema() {
          /* the sequential retry succeeds */
        },
        async find() {
          return [];
        },
      },
      [{ name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } }],
    );

    expect(batchCalls).toBe(1);
    expect(rec.at('warn').some((r) => /Batch schema sync failed/.test(r.message))).toBe(true);
    expect(rec.at('error')).toHaveLength(0);
    expect(rec.at('info').some((r) => /Schema sync complete/.test(r.message))).toBe(true);
  });
});
