// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
  type ProbeInput,
} from '../datasource-admin-service.js';

/**
 * In-memory harness: an editable record store + secret store, with probe and
 * bound-object count stubbable per test. Records what was probed/written so
 * tests can assert credentials never leak into the persisted record.
 */
function makeHarness(opts?: {
  seed?: StoredDatasource[];
  probe?: (input: ProbeInput) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>;
  boundCounts?: Record<string, number>;
}) {
  // Flat list, not a name-keyed map: in production `listDatasourceRecords`
  // merges artefact (code) records with runtime-store records, so the same
  // name can legitimately appear twice (a runtime row shadowed by a code one).
  const records: StoredDatasource[] = (opts?.seed ?? []).map((r) => ({ ...r }));
  /** Resolve the effective record for a name (code wins over runtime). */
  const findEffective = (n: string) =>
    records.find((r) => r.name === n && r.origin !== 'runtime') ??
    records.find((r) => r.name === n);

  const secrets = new Map<string, { value: string; namespace?: string; key?: string }>();
  let secretSeq = 0;
  const probed: ProbeInput[] = [];
  const registered: string[] = [];
  const unregistered: string[] = [];
  const removedSecrets: string[] = [];

  const config: DatasourceAdminServiceConfig = {
    probe: async (input) => {
      probed.push(input);
      return (opts?.probe ?? (async () => ({ ok: true, latencyMs: 3 })))(input);
    },
    listDatasourceRecords: async () => records.map((r) => ({ ...r })),
    getDatasourceRecord: async (n) => {
      const r = findEffective(n);
      return r ? { ...r } : undefined;
    },
    putDatasourceRecord: async (record) => {
      const idx = records.findIndex((r) => r.name === record.name && r.origin === 'runtime');
      if (idx >= 0) records[idx] = { ...record };
      else records.push({ ...record });
    },
    deleteDatasourceRecord: async (n) => {
      const idx = records.findIndex((r) => r.name === n && r.origin === 'runtime');
      if (idx >= 0) records.splice(idx, 1);
    },
    writeSecret: async (input, hint) => {
      const ref = `sys_secret://datasource/${input.key ?? hint.name}#${++secretSeq}`;
      secrets.set(ref, { value: input.value, namespace: input.namespace, key: input.key });
      return ref;
    },
    removeSecret: async (ref) => {
      removedSecrets.push(ref);
      secrets.delete(ref);
    },
    countBoundObjects: async (n) => opts?.boundCounts?.[n] ?? 0,
    registerPool: (record) => {
      registered.push(record.name);
    },
    unregisterPool: (name) => {
      unregistered.push(name);
    },
  };

  const service = new DatasourceAdminService(config);
  // Thin accessor over the flat record list, runtime-preferring (tests assert
  // on the persisted runtime row, e.g. after create/update).
  const store = {
    get: (n: string) =>
      records.find((r) => r.name === n && r.origin === 'runtime') ??
      records.find((r) => r.name === n),
    has: (n: string) => records.some((r) => r.name === n),
    get size() {
      return records.length;
    },
  };
  return { service, store, secrets, probed, registered, unregistered, removedSecrets };
}

describe('listDatasources', () => {
  it('reports origin + dedupes by name (code wins, flags shadowed runtime)', async () => {
    const { service } = makeHarness({
      seed: [
        { name: 'crm_primary', driver: 'sqlite', origin: 'code', definedIn: '@example/crm' },
        { name: 'crm_primary', driver: 'postgres', origin: 'runtime' },
        { name: 'reporting', driver: 'postgres', schemaMode: 'external', origin: 'runtime' },
      ],
    });

    const list = await service.listDatasources();
    const crm = list.find((d) => d.name === 'crm_primary')!;
    const reporting = list.find((d) => d.name === 'reporting')!;

    expect(list).toHaveLength(2);
    expect(crm.origin).toBe('code');
    expect(crm.driver).toBe('sqlite'); // code wins over the runtime row
    expect(crm.definedIn).toBe('@example/crm');
    expect(crm.conflictsWithCode).toBe(true);
    expect(reporting.origin).toBe('runtime');
    expect(reporting.schemaMode).toBe('external');
    expect(reporting.conflictsWithCode).toBeUndefined();
  });
});

describe('testConnection', () => {
  it('probes with the cleartext secret without persisting anything', async () => {
    const { service, store, probed } = makeHarness();
    const res = await service.testConnection(
      { name: 'tmp', driver: 'postgres', config: { host: 'db.internal' } },
      { value: 's3cret' },
    );
    expect(res.ok).toBe(true);
    expect(probed[0].secret).toBe('s3cret');
    expect(store.size).toBe(0); // nothing saved
  });

  it('returns ok:false when no driver is supplied', async () => {
    const { service } = makeHarness();
    const res = await service.testConnection({ name: 'x', driver: '' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/driver is required/i);
  });

  it('captures a thrown probe error as ok:false', async () => {
    const { service } = makeHarness({
      probe: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const res = await service.testConnection({ name: 'x', driver: 'postgres' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
  });
});

describe('createDatasource', () => {
  it('persists a runtime record and stores the secret as an opaque ref only', async () => {
    const { service, store, secrets } = makeHarness();
    const summary = await service.createDatasource(
      {
        name: 'reporting',
        driver: 'postgres',
        schemaMode: 'external',
        config: { host: 'db.internal', database: 'analytics' },
        external: { allowWrites: false },
      },
      { value: 'postgres://user:pw@db.internal/analytics' },
    );

    expect(summary.origin).toBe('runtime');
    const rec = store.get('reporting')!;
    expect(rec.origin).toBe('runtime');
    // credential is referenced, never inlined
    expect(rec.external?.credentialsRef).toBeTruthy();
    expect(JSON.stringify(rec)).not.toContain('postgres://');
    expect(JSON.stringify(rec)).not.toContain('pw@');
    expect(secrets.size).toBe(1);
  });

  it('hot-registers the pool after create', async () => {
    const { service, registered } = makeHarness();
    await service.createDatasource({ name: 'reporting', driver: 'postgres' });
    expect(registered).toContain('reporting');
  });

  it('rejects a name owned by a code-defined datasource', async () => {
    const { service } = makeHarness({
      seed: [{ name: 'crm_primary', driver: 'sqlite', origin: 'code' }],
    });
    await expect(
      service.createDatasource({ name: 'crm_primary', driver: 'postgres' }),
    ).rejects.toThrow(/code-defined/i);
  });

  it('rejects a duplicate runtime name', async () => {
    const { service } = makeHarness({
      seed: [{ name: 'reporting', driver: 'postgres', origin: 'runtime' }],
    });
    await expect(
      service.createDatasource({ name: 'reporting', driver: 'postgres' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects an invalid name', async () => {
    const { service } = makeHarness();
    await expect(
      service.createDatasource({ name: 'Bad-Name', driver: 'postgres' }),
    ).rejects.toThrow(/must match/i);
  });
});

describe('updateDatasource', () => {
  it('patches a runtime record and rewraps the secret, removing the old ref', async () => {
    const { service, store, secrets, removedSecrets } = makeHarness({
      seed: [
        {
          name: 'reporting',
          driver: 'postgres',
          origin: 'runtime',
          external: { credentialsRef: 'sys_secret://datasource/reporting#0' },
        },
      ],
    });
    secrets.set('sys_secret://datasource/reporting#0', { value: 'old' });

    const summary = await service.updateDatasource(
      'reporting',
      { label: 'Reporting DB', active: false },
      { value: 'new-pw' },
    );

    expect(summary.label).toBe('Reporting DB');
    expect(summary.active).toBe(false);
    const rec = store.get('reporting')!;
    expect(rec.external?.credentialsRef).not.toBe('sys_secret://datasource/reporting#0');
    expect(removedSecrets).toContain('sys_secret://datasource/reporting#0');
  });

  it('preserves the existing credentialsRef when external is patched without a new secret', async () => {
    const ref = 'sys_secret://datasource/reporting#0';
    const { service, store } = makeHarness({
      seed: [
        { name: 'reporting', driver: 'postgres', origin: 'runtime', external: { credentialsRef: ref } },
      ],
    });
    await service.updateDatasource('reporting', { external: { allowWrites: true } });
    expect(store.get('reporting')!.external?.credentialsRef).toBe(ref);
  });

  it('rejects editing a code-defined datasource', async () => {
    const { service } = makeHarness({
      seed: [{ name: 'crm_primary', driver: 'sqlite', origin: 'code' }],
    });
    await expect(
      service.updateDatasource('crm_primary', { label: 'x' }),
    ).rejects.toThrow(/code-defined/i);
  });

  it('rejects updating a missing datasource', async () => {
    const { service } = makeHarness();
    await expect(service.updateDatasource('nope', { label: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('removeDatasource', () => {
  it('removes a runtime record, its secret, and the pool', async () => {
    const ref = 'sys_secret://datasource/reporting#0';
    const { service, store, removedSecrets, unregistered } = makeHarness({
      seed: [
        { name: 'reporting', driver: 'postgres', origin: 'runtime', external: { credentialsRef: ref } },
      ],
    });
    await service.removeDatasource('reporting');
    expect(store.has('reporting')).toBe(false);
    expect(removedSecrets).toContain(ref);
    expect(unregistered).toContain('reporting');
  });

  it('refuses to remove while objects are still bound', async () => {
    const { service, store } = makeHarness({
      seed: [{ name: 'reporting', driver: 'postgres', origin: 'runtime' }],
      boundCounts: { reporting: 3 },
    });
    await expect(service.removeDatasource('reporting')).rejects.toThrow(/3 object\(s\)/);
    expect(store.has('reporting')).toBe(true);
  });

  it('refuses to remove a code-defined datasource', async () => {
    const { service } = makeHarness({
      seed: [{ name: 'crm_primary', driver: 'sqlite', origin: 'code' }],
    });
    await expect(service.removeDatasource('crm_primary')).rejects.toThrow(/code-defined/i);
  });

  it('rejects removing a missing datasource', async () => {
    const { service } = makeHarness();
    await expect(service.removeDatasource('nope')).rejects.toThrow(/not found/i);
  });
});
