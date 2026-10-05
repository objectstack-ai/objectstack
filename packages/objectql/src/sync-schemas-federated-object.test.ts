// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21777: the runtime schema sync and the boot schema sync route a federated
// (ADR-0015 `external`) object by ONE predicate and give it ONE treatment.
//
// `ObjectQL.syncSchemas()` is what install-local installs, rehydrates and
// template seeding run after registering objects. It had no federated branch,
// so it sent DDL to every federated object in the registry. On the showcase
// those are `showcase_ext_customer` and `showcase_ext_order` on the
// external-schema datasource `showcase_external`. The driver refused the DDL,
// as designed, and the refusal was logged as the #4632 durability ERROR,
// although nothing durable was lost. The boot sync
// (`ObjectQLPlugin.syncRegisteredSchemas`) never did this: it binds a federated
// object with the DDL-free `registerExternalObject` and sends it no DDL.
//
// The three pins:
//   1. `syncSchemas()` sends no DDL to a federated object and logs no ERROR for
//      it. It still installs the remote-table binding.
//   2. Every other object whose DDL is refused still gets the #4632 ERROR.
//   3. The boot sync and `syncSchemas()` make the same driver calls, and report
//      the same objects at ERROR, on one fixture.

import { describe, it, expect } from 'vitest';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
interface Recorded {
  level: Level;
  message: string;
  args: unknown[];
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Level) => (message: string, ...args: unknown[]) =>
    void records.push({ level, message: String(message), args });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Level) {
      return records.filter((r) => r.level === level);
    },
  };
}

/**
 * A driver double that records every schema call it receives. With
 * `refuseDdl`, it refuses all DDL the way `SqlDriver.assertSchemaMutable` does
 * on an external-schema datasource.
 */
function recordingDriver(name: string, refuseDdl: false | 'external-schema' | string) {
  const calls: string[] = [];
  return {
    calls,
    driver: {
      name,
      supports: {},
      async syncSchema(table: string) {
        calls.push(`${name}:syncSchema:${table}`);
        if (refuseDdl === 'external-schema') {
          throw new ExternalSchemaModeViolationError(
            `DDL operation 'initObjects' is forbidden: datasource schemaMode='external'.`,
          );
        }
        if (refuseDdl) throw new Error(refuseDdl);
      },
      registerExternalObject(obj: { name: string }) {
        calls.push(`${name}:registerExternalObject:${obj.name}`);
      },
      async find() {
        return [];
      },
    },
  };
}

/** The showcase's two federated objects, on the external-schema datasource. */
const FEDERATED = [
  {
    name: 'showcase_ext_customer',
    label: 'External Customer',
    datasource: 'showcase_external',
    external: { remoteName: 'customers' },
    fields: { name: { type: 'text' } },
  },
  {
    name: 'showcase_ext_order',
    label: 'External Order',
    datasource: 'showcase_external',
    external: { remoteName: 'orders' },
    fields: { amount: { type: 'currency' } },
  },
];
const INVOICE = { name: 'invoice', label: 'Invoice', fields: { status: { type: 'text' } } };

function engineWith(
  logger: ReturnType<typeof recordingLogger>['logger'],
  defaultRefuses: false | string,
  objects: Array<Record<string, unknown>>,
) {
  const managed = recordingDriver('default', defaultRefuses);
  const external = recordingDriver('showcase_external', 'external-schema');
  const engine = new ObjectQL({ logger } as any);
  engine.registerDriver(managed.driver as any, true);
  engine.registerDriver(external.driver as any);
  for (const obj of objects) engine.registerObject(obj as any);
  return { engine, managed, external };
}

/** Objects reported by a per-object ERROR, read from the structured context, not the prose. */
function erroredObjects(rec: ReturnType<typeof recordingLogger>): string[] {
  return rec
    .at('error')
    .map((r) => (r.args[1] as { object?: string } | undefined)?.object)
    .filter((o): o is string => typeof o === 'string')
    .sort();
}

describe('ObjectQL.syncSchemas() — a federated object is not a DDL target (#21777)', () => {
  it('sends no DDL to a federated object and logs no ERROR for it, but still binds it to its remote table', async () => {
    const rec = recordingLogger();
    const { engine, managed, external } = engineWith(rec.logger, false, [...FEDERATED, INVOICE]);

    await engine.syncSchemas();

    expect(rec.at('error')).toHaveLength(0);
    // No DDL reached the external-schema datasource at all ...
    expect(external.calls.filter((c) => c.includes(':syncSchema:'))).toEqual([]);
    // ... and each federated object got the DDL-free binding the boot sync gives it.
    expect(external.calls.sort()).toEqual([
      'showcase_external:registerExternalObject:showcase_ext_customer',
      'showcase_external:registerExternalObject:showcase_ext_order',
    ]);
    // The managed object next to them is still synced.
    expect(managed.calls).toEqual(['default:syncSchema:invoice']);
  });
});

// These pins are about the named object's own ERROR, so they never count the
// whole log: whether the federated objects beside it log anything is pin 1's
// question, and these must not answer it a second time.
describe('ObjectQL.syncSchemas() — the #4632 ERROR still fires for every other refused sync', () => {
  /** The per-object ERROR whose structured context names `object`. */
  function errorFor(rec: ReturnType<typeof recordingLogger>, object: string) {
    return rec.at('error').filter((r) => (r.args[1] as { object?: string } | undefined)?.object === object);
  }

  it('an internal object whose driver refuses DDL is still reported at ERROR, with its Error and context', async () => {
    const rec = recordingLogger();
    const { engine } = engineWith(rec.logger, 'permission denied for schema public', [...FEDERATED, INVOICE]);

    await engine.syncSchemas();

    const errors = errorFor(rec, 'invoice');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'invoice'");
    expect(errors[0].args[0]).toBeInstanceOf(Error);
    expect((errors[0].args[0] as Error).message).toContain('permission denied for schema public');
    expect(errors[0].args[1]).toEqual({ object: 'invoice', tableName: 'invoice', driver: 'default' });
  });

  it('an object WITHOUT `external` on the external-schema datasource is not federated, so its refused DDL stays an ERROR', async () => {
    // The predicate is the object's own `external` block, not its datasource's
    // `schemaMode`. A non-federated object routed to an external-schema
    // datasource expected a table it did not get, so that is a real lost sync.
    const rec = recordingLogger();
    const stray = { name: 'stray_ledger', label: 'Stray Ledger', datasource: 'showcase_external', fields: {} };
    const { engine, external } = engineWith(rec.logger, false, [...FEDERATED, stray]);

    await engine.syncSchemas();

    const errors = errorFor(rec, 'stray_ledger');
    expect(errors).toHaveLength(1);
    expect(errors[0].args[0]).toBeInstanceOf(ExternalSchemaModeViolationError);
    expect(errors[0].args[1]).toEqual({ object: 'stray_ledger', tableName: 'stray_ledger', driver: 'showcase_external' });
    expect(external.calls).toContain('showcase_external:syncSchema:stray_ledger');
  });
});

describe('the boot sync and ObjectQL.syncSchemas() agree on one fixture (#21777)', () => {
  /** Two federated objects, one managed object, and one non-federated object the external datasource refuses. */
  const FIXTURE = [
    ...FEDERATED,
    INVOICE,
    { name: 'stray_ledger', label: 'Stray Ledger', datasource: 'showcase_external', fields: {} },
  ];

  async function runtimeSync() {
    const rec = recordingLogger();
    const { engine, managed, external } = engineWith(rec.logger, false, FIXTURE);
    await engine.syncSchemas();
    return { rec, calls: [...managed.calls, ...external.calls].sort() };
  }

  async function bootSync() {
    const rec = recordingLogger();
    const { engine, managed, external } = engineWith(rec.logger, false, FIXTURE);
    const plugin = new ObjectQLPlugin();
    (plugin as any).ql = engine;
    await (plugin as any).syncRegisteredSchemas({ logger: rec.logger });
    return { rec, calls: [...managed.calls, ...external.calls].sort() };
  }

  it('makes the same driver calls: a binding for each federated object, DDL for everything else', async () => {
    const runtime = await runtimeSync();
    const boot = await bootSync();

    expect(runtime.calls).toEqual(boot.calls);
    expect(boot.calls).toEqual([
      'default:syncSchema:invoice',
      'showcase_external:registerExternalObject:showcase_ext_customer',
      'showcase_external:registerExternalObject:showcase_ext_order',
      'showcase_external:syncSchema:stray_ledger',
    ]);
  });

  it('reports the same objects at ERROR: the refused non-federated one, never a federated one', async () => {
    const runtime = await runtimeSync();
    const boot = await bootSync();

    expect(erroredObjects(runtime.rec)).toEqual(erroredObjects(boot.rec));
    expect(erroredObjects(boot.rec)).toEqual(['stray_ledger']);
  });
});
