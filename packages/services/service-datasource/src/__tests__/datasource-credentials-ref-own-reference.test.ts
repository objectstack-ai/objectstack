// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27722 — the datasource admin door applies the #27582 own-reference rule to
 * `external.credentialsRef`: **a write may only seal a new value or keep its
 * own record's stored reference.**
 *
 * The door's callers are the admin routes (`POST` / `PATCH /datasources`), a
 * signed-in operator every time; nothing system-side writes through this
 * service, so there is no pass-through to keep here.
 *
 *  - **create** — a new record has no reference of its own to keep, so a draft
 *    that names `external.credentialsRef` is refused, with one answer whatever
 *    it names, before anything is written. The credential arrives as `secret`
 *    and the door binds it; that reference is the only one a create stores.
 *  - **update** — the record keeps the reference it already holds unless a
 *    supplied `secret` rewraps it. A patch that names any other reference never
 *    reaches the stored record.
 *
 * The harness is the service's own config seam, so each case reads exactly
 * what the door persisted, bound, removed and registered.
 */

import { describe, expect, it } from 'vitest';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';

/** A reference some other write minted — the kind a caller must not store. */
const OTHER_REF = 'sys_secret:sec_minted_elsewhere';

function makeHarness(seed: StoredDatasource[] = []) {
  const records: StoredDatasource[] = seed.map((r) => ({ ...r }));
  const secrets = new Map<string, string>([[OTHER_REF, 'other-credential']]);
  const ops: string[] = [];
  let seq = 0;

  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true }),
    listDatasourceRecords: async () => records.map((r) => ({ ...r })),
    getDatasourceRecord: async (name) => {
      const r = records.find((x) => x.name === name);
      return r ? { ...r } : undefined;
    },
    putDatasourceRecord: async (record) => {
      ops.push(`put:${record.name}`);
      const idx = records.findIndex((r) => r.name === record.name);
      if (idx >= 0) records[idx] = { ...record };
      else records.push({ ...record });
    },
    deleteDatasourceRecord: async (name) => {
      ops.push(`delete:${name}`);
      const idx = records.findIndex((r) => r.name === name);
      if (idx >= 0) records.splice(idx, 1);
    },
    writeSecret: async (input) => {
      const ref = `sys_secret:sec_minted_${++seq}`;
      ops.push(`writeSecret:${ref}`);
      secrets.set(ref, input.value);
      return ref;
    },
    removeSecret: async (ref) => {
      ops.push(`removeSecret:${ref}`);
      secrets.delete(ref);
    },
    readSecret: async (ref) => secrets.get(ref),
    countBoundObjects: async () => 0,
    listObjectsBoundTo: async () => [],
    registerPool: (record) => {
      ops.push(`registerPool:${record.name}`);
    },
    unregisterPool: (name) => {
      ops.push(`unregisterPool:${name}`);
    },
  };

  const service = new DatasourceAdminService(config);
  const stored = (name: string) => records.find((r) => r.name === name);
  return { service, stored, secrets, ops };
}

const DRAFT = {
  name: 'reporting',
  driver: 'postgres',
  config: { host: 'db.internal', database: 'analytics' },
};

describe('#27722 — a create may not carry a stored credential reference', () => {
  it.each([
    ['a reference another write minted', OTHER_REF],
    ['a reference that names nothing', 'sys_secret:sec_never_minted'],
    ['a value in no reference shape', 'not-a-reference'],
  ])('refuses %s, writing nothing', async (_label, ref) => {
    const { service, stored, secrets, ops } = makeHarness();

    await expect(
      service.createDatasource({ ...DRAFT, external: { credentialsRef: ref } }),
    ).rejects.toThrow(/external\.credentialsRef/);

    expect(stored('reporting')).toBeUndefined();
    expect(ops).toEqual([]);
    expect(secrets.get(OTHER_REF)).toBe('other-credential');
  });

  it('answers the same whatever the reference names, and never echoes it', async () => {
    const messages: string[] = [];
    for (const ref of [OTHER_REF, 'sys_secret:sec_never_minted', 'not-a-reference']) {
      const { service } = makeHarness();
      const err = await service
        .createDatasource({ ...DRAFT, external: { credentialsRef: ref } })
        .catch((e: unknown) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain(ref);
      messages.push((err as Error).message);
    }
    expect(new Set(messages).size).toBe(1);
  });

  it('refuses it beside a supplied secret too: the door mints the only reference a create stores', async () => {
    const { service, stored, ops } = makeHarness();

    await expect(
      service.createDatasource(
        { ...DRAFT, external: { credentialsRef: OTHER_REF } },
        { value: 'fresh-credential' },
      ),
    ).rejects.toThrow(/external\.credentialsRef/);

    expect(stored('reporting')).toBeUndefined();
    expect(ops).toEqual([]);
  });

  it('stores the reference its own secret was sealed under', async () => {
    const { service, stored, secrets } = makeHarness();

    await service.createDatasource(DRAFT, { value: 'fresh-credential' });

    const ref = stored('reporting')?.external?.credentialsRef;
    expect(ref).toMatch(/^sys_secret:sec_minted_/);
    expect(ref).not.toBe(OTHER_REF);
    expect(secrets.get(ref!)).toBe('fresh-credential');
  });

  it('still creates a record that names no reference at all', async () => {
    const { service, stored } = makeHarness();

    await service.createDatasource({ ...DRAFT, schemaMode: 'external', external: { allowWrites: false } });

    expect(stored('reporting')).toBeDefined();
    expect(stored('reporting')?.external?.credentialsRef).toBeUndefined();
  });
});

describe('#27722 — an update keeps its own reference and stores no other', () => {
  const OWN_REF = 'sys_secret:sec_own';

  it('keeps the record\'s own reference when a patch names another', async () => {
    const { service, stored, secrets, ops } = makeHarness([
      { ...DRAFT, origin: 'runtime', external: { credentialsRef: OWN_REF } },
    ]);

    await service.updateDatasource('reporting', { external: { credentialsRef: OTHER_REF } });

    expect(stored('reporting')?.external?.credentialsRef).toBe(OWN_REF);
    expect(ops).not.toContain(`removeSecret:${OTHER_REF}`);
    expect(secrets.get(OTHER_REF)).toBe('other-credential');
  });

  it('stores no reference on a record that holds none when a patch names one', async () => {
    const { service, stored } = makeHarness([{ ...DRAFT, origin: 'runtime' }]);

    await service.updateDatasource('reporting', { external: { credentialsRef: OTHER_REF } });

    expect(stored('reporting')?.external?.credentialsRef).toBeUndefined();
  });

  it('replaces its own reference only with the one a supplied secret is sealed under', async () => {
    const { service, stored, secrets, ops } = makeHarness([
      { ...DRAFT, origin: 'runtime', external: { credentialsRef: OWN_REF } },
    ]);

    await service.updateDatasource(
      'reporting',
      { external: { credentialsRef: OTHER_REF } },
      { value: 'rotated-credential' },
    );

    const ref = stored('reporting')?.external?.credentialsRef;
    expect(ref).toMatch(/^sys_secret:sec_minted_/);
    expect(secrets.get(ref!)).toBe('rotated-credential');
    expect(ops).toContain(`removeSecret:${OWN_REF}`);
    expect(ops).not.toContain(`removeSecret:${OTHER_REF}`);
    expect(secrets.get(OTHER_REF)).toBe('other-credential');
  });
});
