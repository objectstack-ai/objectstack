// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10995] `OS_SKIP_SCHEMA_SYNC` is about DDL — it must not also stop the
 * drivers from being TOLD what their objects look like.
 *
 * ## The accident this pins
 *
 * A SQL driver builds its per-object coercion registries (JSON, boolean,
 * numeric, date/datetime/time, auto_number, tenant column) as the first step of
 * `syncSchema()` — a DDL call. `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` is the
 * documented posture for deployments whose migrations run out-of-band, and it
 * skipped that call entirely, so those deployments served every write with the
 * registries EMPTY. On Postgres that is not a slow path but a data-correctness
 * defect: an array on a `json` field is rendered by node-postgres as a Postgres
 * ARRAY LITERAL and rejected (`22P02`) — **except `[]`, whose literal `{}` is
 * valid JSON, so an empty array was accepted and silently stored as an empty
 * OBJECT**. `packages/drivers/driver-sql/src/sql-driver-json-binding-without-ddl.test.ts`
 * pins the encoding half against a live Postgres; this file pins the boot half:
 * that the flag routes to the DDL-FREE registration instead of to nothing.
 *
 * It is the same ruling #7737/#10629 already made for FEDERATED objects — that
 * flag is about DDL, and a binding that is DDL-free must not ride on it —
 * extended to the managed ones.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
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

/** A driver that records which of the two registration routes it was given. */
function recordingDriver(opts: { metadataRoute?: boolean; throws?: boolean } = {}) {
  const withMetadataRoute = opts.metadataRoute !== false;
  const calls = {
    syncSchema: [] as string[],
    registerObjectMetadata: [] as string[][],
    registerExternalObject: [] as string[],
  };
  const driver: Record<string, unknown> = {
    name: 'default',
    supports: {},
    async find() {
      return [];
    },
    async syncSchema(table: string) {
      calls.syncSchema.push(table);
    },
    async registerExternalObject(obj: any) {
      calls.registerExternalObject.push(obj?.name);
    },
  };
  if (withMetadataRoute) {
    driver.registerObjectMetadata = (objects: any[]) => {
      if (opts.throws) throw new Error('registry write failed');
      calls.registerObjectMetadata.push(objects.map((o) => o?.name));
    };
  }
  return { driver, calls };
}

/** Drive the boot seam directly: which route the flag takes IS the unit. */
async function install(
  skipSchemaSync: boolean,
  objects: ServiceObject[],
  driver: unknown,
) {
  const rec = recordingLogger();
  const plugin = new ObjectQLPlugin();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  engine.registerDriver(driver as any);
  for (const obj of objects) engine.registerObject(obj);
  (plugin as any).ql = engine;
  (plugin as any).skipSchemaSync = skipSchemaSync;
  await (plugin as any).installRegisteredSchemas({ logger: rec.logger });
  return rec;
}

const PREF: ServiceObject = {
  name: 'sys_user_preference',
  label: 'User Preference',
  fields: { id: { type: 'text' }, key: { type: 'text' }, value: { type: 'json' } },
} as ServiceObject;

const NOTE: ServiceObject = {
  name: 'note',
  label: 'Note',
  fields: { id: { type: 'text' }, body: { type: 'text' } },
} as ServiceObject;

describe('OS_SKIP_SCHEMA_SYNC boot registers object metadata without DDL (#10995)', () => {
  it('registers every managed object with the driver, and runs no DDL', async () => {
    const { driver, calls } = recordingDriver();
    await install(true, [PREF, NOTE], driver);

    // The whole point: the objects reached the driver …
    expect(calls.registerObjectMetadata).toHaveLength(1);
    expect(calls.registerObjectMetadata[0]).toEqual(['sys_user_preference', 'note']);
    // … and no DDL was issued, which is what the flag actually opts out of.
    expect(calls.syncSchema).toEqual([]);
  });

  it('still syncs (and does NOT take the metadata-only route) when the flag is off', async () => {
    const { driver, calls } = recordingDriver();
    await install(false, [PREF, NOTE], driver);

    expect(calls.syncSchema).toEqual(['sys_user_preference', 'note']);
    expect(calls.registerObjectMetadata).toEqual([]);
  });

  it('reports the registration in the skip line, so a boot can be audited', async () => {
    const { driver } = recordingDriver();
    const rec = await install(true, [PREF, NOTE], driver);

    const line = rec.at('info').find((r) => /OS_SKIP_SCHEMA_SYNC/.test(r.message));
    expect(line).toBeDefined();
    // Before this change the same line said only that sync was skipped — a boot
    // that had told its drivers nothing read exactly like one that had.
    expect(line!.message).toMatch(/WITHOUT DDL/);
    expect(line!.message).toContain('registered 2 object schema(s)');
    expect(line!.args[0]).toMatchObject({ registered: 2, total: 2 });
  });

  it('leaves federated objects to registerExternalObject, which is already DDL-free', async () => {
    const external = {
      name: 'legacy_customer',
      label: 'Legacy Customer',
      fields: { id: { type: 'text' } },
      external: { remoteName: 'customers' },
    } as unknown as ServiceObject;
    const { driver, calls } = recordingDriver();
    await install(true, [PREF, external], driver);

    // The managed one only — #7737/#10629 already bind the federated one at
    // `kernel:ready`, and handing it to the managed route would register it
    // under its OBJECT name instead of its remote table.
    expect(calls.registerObjectMetadata[0]).toEqual(['sys_user_preference']);
  });

  it('degrades without throwing when a driver has no metadata route', async () => {
    const { driver, calls } = recordingDriver({ metadataRoute: false });
    const rec = await install(true, [PREF], driver);

    expect(calls.syncSchema).toEqual([]);
    const line = rec.at('info').find((r) => /OS_SKIP_SCHEMA_SYNC/.test(r.message));
    expect(line!.args[0]).toMatchObject({ registered: 0, unsupported: 1 });
  });

  it('reports a failed registration at error, naming the consequence', async () => {
    const { driver } = recordingDriver({ throws: true });
    const rec = await install(true, [PREF], driver);

    const err = rec.at('error')[0];
    expect(err).toBeDefined();
    // From the outside the deployment looks healthy, so the log has to say what
    // is actually wrong with it.
    expect(err.message).toMatch(/never told their field types/);
    expect(err.message).toMatch(/empty array is silently stored as an empty object/);
    expect(err.args[0]).toBeInstanceOf(Error);
  });
});
