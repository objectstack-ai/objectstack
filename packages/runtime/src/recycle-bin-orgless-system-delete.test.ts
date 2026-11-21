// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A system-door delete of a record that carries no organization keeps it in
 * the recycle bin under the organization ADR-0131 D9 answers, on the memory
 * store and on a SQL store.
 *
 * ## The reading this pins
 *
 * Measured before the fix (the same composition as below): a delete through
 * `{ isSystem: true }`, the context flows, hooks and admin tooling carry, of a
 * record of a `tenancy: { enabled: false }` object failed on SQLite with
 * `NOT NULL constraint failed: sys_recycle_bin.organization_id` and left the
 * record in place; on the memory store it answered `true` and wrote the entry
 * with no organization at all. The record names no organization and the
 * context names none, and the capture wrote its entry raw with neither.
 *
 * The entry is a row of a tenant-column object (ADR-0148 D1), so it takes the
 * organization any system insert takes (ADR-0131 D9): the Default
 * Organization under `single`, and a loud
 * `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` refusal under a wall, before the
 * record is removed.
 *
 * ## What is real here
 *
 * A real `ObjectQL` over the real `InMemoryDriver` and a real `SqlDriver` on
 * better-sqlite3 (which creates the bin's tenant column NOT NULL), the bin as
 * `@objectstack/platform-objects` declares it, and the Default Organization
 * the `single` posture holds (`installDefaultOrganization`). Codes, statuses,
 * ids and organizations are asserted, never wording.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { SysRecycleBin } from '@objectstack/platform-objects/system';
import { RECYCLE_BIN_OBJECT } from '@objectstack/spec/data';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const GLOBAL = 'rbo_global_note';
const SYSTEM = { context: { isSystem: true } } as const;

type Store = 'memory' | 'sqlite';

async function boot(store: Store, posture: 'single' | 'isolated') {
  const engine = new ObjectQL();
  engine.registerDriver(
    (store === 'memory'
      ? new InMemoryDriver()
      : new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })) as never,
    true,
  );
  engine.setTenancyPostureProvider(() => posture);
  await engine.init();
  engine.registry.registerObject(SysRecycleBin as never, '@objectstack/platform-objects');
  engine.registry.registerObject(
    { name: GLOBAL, label: 'Global note', tenancy: { enabled: false }, fields: { title: { type: 'text', label: 'Title' } } } as never,
    'rbo',
  );
  await engine.syncSchemas();
  await installDefaultOrganization(engine as never);
  const created = (await engine.insert(GLOBAL, { title: 'kept' }, SYSTEM as never)) as { id: string };
  return { engine, id: String(created.id) };
}

const entries = async (engine: ObjectQL) =>
  (await engine.find(RECYCLE_BIN_OBJECT, SYSTEM as never)) as Array<Record<string, unknown>>;
const stillThere = async (engine: ObjectQL, id: string) =>
  (await engine.find(GLOBAL, { where: { id }, ...SYSTEM } as never)) as Array<Record<string, unknown>>;

for (const store of ['memory', 'sqlite'] as const) {
  describe(`a system-door delete of a tenancy-disabled record on ${store}`, () => {
    it('under single: answers true, the entry carries the Default Organization, and restore brings the record back', async () => {
      const { engine, id } = await boot(store, 'single');
      let entryId: string | undefined;

      const answer = await engine.delete(GLOBAL, {
        where: { id },
        ...SYSTEM,
        onRecycleBinEntry: (e: string) => { entryId = e; },
      } as never);

      expect(answer).toBe(true);
      expect(await stillThere(engine, id)).toHaveLength(0);
      const [entry, ...rest] = await entries(engine);
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({ object_name: GLOBAL, record_id: id, organization_id: DEFAULT_ORGANIZATION_ID });
      expect(entryId).toBe(String(entry.id));

      const restored = await engine.restore(String(entry.id), SYSTEM as never);
      expect(restored).toMatchObject({ object: GLOBAL, recordId: id });
      expect(await stillThere(engine, id)).toMatchObject([{ id, title: 'kept' }]);
      expect(await entries(engine)).toHaveLength(0);
    });

    it('CONTROL a context that names an organization: the entry carries the context\'s, as before', async () => {
      const { engine, id } = await boot(store, 'single');
      expect(await engine.delete(GLOBAL, { where: { id }, context: { isSystem: true, tenantId: 'org_named' } } as never)).toBe(true);
      expect(await entries(engine)).toMatchObject([{ record_id: id, organization_id: 'org_named' }]);
    });

    it('under a wall: refused with ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED, and the record stays with no entry', async () => {
      const { engine, id } = await boot(store, 'isolated');

      const refusal = await engine.delete(GLOBAL, { where: { id }, ...SYSTEM } as never).then(
        () => undefined,
        (e: unknown) => e as { code?: unknown; status?: unknown },
      );

      expect(refusal).toMatchObject({ code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED', status: 500 });
      expect(await stillThere(engine, id)).toMatchObject([{ id, title: 'kept' }]);
      expect(await entries(engine)).toHaveLength(0);
    });
  });
}
