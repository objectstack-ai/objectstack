// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22985] A bound object's schema sync refused at connect is a DURABILITY
 * degradation, so it is reported at `error` — once per object per connect —
 * and the connect is not failed.
 *
 * `connect()` re-drives `syncObjectSchema` for every object bound to the
 * datasource it just connected, because the boot's own schema sync ran before
 * this driver existed. When that call throws, the datasource still answers
 * `connected` and the object stays registered and served with no working
 * storage — a managed object has no table, a federated one is not bound to its
 * remote table. Nothing about the connect looks wrong from the outside, which
 * is the class AGENTS.md "Degradation log levels" sends to `error`.
 *
 * The wording is not pinned: the pins hold the level, the count, the named
 * object and datasource, the named remedy and the driver's refusal in meta —
 * and the "looks healthy" half, as the connect verdict an operator reads.
 */

import { describe, it, expect } from 'vitest';
import {
  DatasourceConnectionService,
  type ConnectableDatasource,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import type { IDatasourceDriverFactory } from '../contracts/datasource-driver-factory.js';
import type { IDataDriver } from '@objectstack/spec/contracts';

/** An engine whose schema sync refuses the objects in `refused` and syncs the rest. */
function engineRefusing(refused: Set<string>) {
  const drivers = new Map<string, { name?: string }>();
  const synced: string[] = [];
  const engine: ConnectionEngineLike = {
    registerDriver: (driver) => {
      if (!drivers.has(driver.name)) drivers.set(driver.name, driver);
    },
    registerDatasourceDef: () => {},
    getDriverByName: (name) => drivers.get(name) as IDataDriver | undefined,
    syncObjectSchema: async (name) => {
      if (refused.has(name)) throw new Error(`there is already an index named ${name}`);
      synced.push(name);
    },
  };
  return { engine, synced };
}

function factory(): IDatasourceDriverFactory {
  return {
    supports: () => true,
    create: async () => ({ driver: { name: 'com.fake.driver' }, connect: async () => {} }),
  };
}

type ErrorCall = { message: string; meta: unknown };

/** A sink recording both channels; `withError: false` is the contract's `{ warn }`-only sink. */
function sink(withError = true) {
  const warn: string[] = [];
  const error: ErrorCall[] = [];
  const logger = {
    warn: (message: string) => { warn.push(message); },
    info: () => {},
    ...(withError ? { error: (message: string, meta?: unknown) => { error.push({ message, meta }); } } : {}),
  };
  return { logger, warn, error };
}

const reporting: ConnectableDatasource = {
  name: 'reporting',
  driver: 'sqlite',
  schemaMode: 'managed',
  config: {},
};
const OBJECTS = [
  { name: 'report_row', datasource: 'reporting' },
  { name: 'report_rollup', datasource: 'reporting' },
];

async function connect(refused: Set<string>, withError = true) {
  const { engine, synced } = engineRefusing(refused);
  const log = sink(withError);
  const service = new DatasourceConnectionService({
    factory: () => factory(),
    engine: () => engine,
    logger: log.logger,
  });
  const results = await service.connectDeclared({ datasources: [reporting], objects: OBJECTS });
  return { results, synced, service, log };
}

describe('DatasourceConnectionService — a refused bound-object sync is an error, once per object (#22985)', () => {
  it('a refused sync logs exactly one error line naming the object, the datasource, the remedy and the refusal', async () => {
    const { results, synced, service, log } = await connect(new Set(['report_row']));

    // The half that makes it the durability class: from the outside the
    // connect looks healthy — the verdict an operator and the admin list read.
    expect(results).toEqual([{ name: 'reporting', status: 'connected' }]);
    expect(service.getConnectionState('reporting')?.status).toBe('connected');

    expect(log.error).toHaveLength(1);
    const [line] = log.error;
    expect(line.message).toContain("object 'report_row'");
    expect(line.message).toContain("datasource 'reporting'");
    // ② the fix, by its named subject.
    expect(line.message).toContain('restart');
    // One line: the first line carries both halves.
    expect(line.message).not.toContain('\n');
    // The driver's refusal travels in meta, never interpolated into the line.
    expect(line.message).not.toContain('there is already an index');
    expect(line.meta).toEqual({
      datasource: 'reporting',
      object: 'report_row',
      error: 'there is already an index named report_row',
    });
    // …and it is not ALSO reported at a quieter level.
    expect(log.warn).toEqual([]);
    // The connect is not failed: the other bound object still synced.
    expect(synced).toEqual(['report_rollup']);
  });

  it('every refused object gets its own line', async () => {
    const { log } = await connect(new Set(['report_row', 'report_rollup']));

    expect(log.error.map((c) => (c.meta as { object: string }).object)).toEqual(['report_row', 'report_rollup']);
  });

  it('a `{ warn }`-only sink still prints the line — the fallback, never an optional `error?.()`', async () => {
    const { log } = await connect(new Set(['report_row']), false);

    expect(log.warn).toHaveLength(1);
    expect(log.warn[0]).toContain("object 'report_row'");
  });

  it('CONTROL: a clean connect logs no error and syncs every bound object', async () => {
    const { results, synced, log } = await connect(new Set());

    expect(results).toEqual([{ name: 'reporting', status: 'connected' }]);
    expect(log.error).toEqual([]);
    expect(log.warn).toEqual([]);
    expect(synced).toEqual(['report_row', 'report_rollup']);
  });
});
