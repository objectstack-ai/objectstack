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
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: unknown;
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, meta?: unknown) =>
    void records.push({ level, message: String(message), meta });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
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
    // The driver's own error is preserved for diagnosis.
    expect(JSON.stringify(errors[0].meta)).toContain('no such column: status');
  });

  it('does not hide the failure at warn/debug — the level is the whole point', async () => {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver(failingDriver('default', 'boom') as any);
    engine.registerObject({ name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } } as any);

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
    engine.registerObject({ name: 'invoice', label: 'Invoice', fields: { id: { type: 'text' } } } as any);

    await engine.syncSchemas();

    expect(rec.at('error')).toHaveLength(0);
  });
});

describe('ObjectQLPlugin.syncRegisteredSchemas() — per-object and summary levels (#4632)', () => {
  /** Drive the private sync pass directly: the level is the unit under test. */
  async function runSync(driver: unknown, objects: Array<Record<string, unknown>>) {
    const rec = recordingLogger();
    const plugin = new ObjectQLPlugin();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver(driver as any);
    for (const obj of objects) engine.registerObject(obj as any);
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
    expect(JSON.stringify(perObject!.meta)).toContain('permission denied for schema public');
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
    expect(summary!.meta).toMatchObject({ failed: 2, synced: 0 });
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
