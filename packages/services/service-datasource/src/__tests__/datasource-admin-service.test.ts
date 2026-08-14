// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DatasourceSchema } from '@objectstack/spec/data';
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
  /** Omit the secret store's READ side entirely (a host with no `resolve`). */
  noReadSecret?: boolean;
  /** Make every read-back answer this instead of the stored cleartext (#8155). */
  readBackOverride?: () => Promise<string | undefined>;
  /** Make the record write fail — the rollback path for a freshly-minted secret. */
  failPut?: () => boolean;
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
  /** Ordered log of the store calls — the seam #8155's durability order is read from. */
  const ops: string[] = [];
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
      ops.push(`put:${record.name}`);
      if (opts?.failPut?.()) throw new Error('metadata store unavailable');
      const idx = records.findIndex((r) => r.name === record.name && r.origin === 'runtime');
      if (idx >= 0) records[idx] = { ...record };
      else records.push({ ...record });
    },
    deleteDatasourceRecord: async (n) => {
      const idx = records.findIndex((r) => r.name === n && r.origin === 'runtime');
      if (idx >= 0) records.splice(idx, 1);
    },
    writeSecret: async (input, hint) => {
      ops.push('writeSecret');
      const ref = `sys_secret://datasource/${input.key ?? hint.name}#${++secretSeq}`;
      secrets.set(ref, { value: input.value, namespace: input.namespace, key: input.key });
      return ref;
    },
    removeSecret: async (ref) => {
      ops.push('removeSecret');
      removedSecrets.push(ref);
      secrets.delete(ref);
    },
    // The store's READ side, mirroring `SecretBinder.resolve` (#8155).
    ...(opts?.noReadSecret
      ? {}
      : {
          readSecret: async (ref: string) => {
            ops.push('readSecret');
            if (opts?.readBackOverride) return opts.readBackOverride();
            return secrets.get(ref)?.value;
          },
        }),
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
  return { service, store, secrets, probed, registered, unregistered, removedSecrets, ops };
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
      { name: 'tmp', driver: 'postgres', config: { host: 'db.internal', database: 'analytics' } },
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
    const res = await service.testConnection({
      name: 'x',
      driver: 'postgres',
      config: { database: 'app' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
  });

  // #4410. A probe is the wizard's evidence that a connection works, so it must
  // not run against a config the driver would silently discard: `hostname` is
  // dropped, `pg` opens its own localhost default, and a green "Connection
  // successful" is reported for a datasource pointing somewhere else.
  it('refuses to probe a config the driver would silently ignore', async () => {
    const { service, probed } = makeHarness();
    const res = await service.testConnection({
      name: 'x',
      driver: 'postgres',
      config: { hostname: 'db.internal', database: 'app' },
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('`hostname` → `host`');
    expect(probed).toHaveLength(0);
  });

  it('probes a driver the platform ships no contract for, unchanged', async () => {
    const { service, probed } = makeHarness();
    const res = await service.testConnection({
      name: 'x',
      driver: 'com.vendor.snowflake',
      config: { account: 'xy12345' },
    });

    expect(res.ok).toBe(true);
    expect(probed).toHaveLength(1);
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
    await service.createDatasource({
      name: 'reporting',
      driver: 'postgres',
      config: { database: 'analytics' },
    });
    expect(registered).toContain('reporting');
  });

  // The wizard is the OTHER authoring door: `createDatasource` writes through
  // `metadata.register`, whose validation is a structural name/label check, so
  // a bad config reached the store even after DatasourceSchema's gate landed.
  it('rejects a config its driver would not honour (#4410)', async () => {
    const { service, store } = makeHarness();
    await expect(
      service.createDatasource({
        name: 'reporting',
        driver: 'postgres',
        config: { hostname: 'db.internal', database: 'analytics' },
      }),
    ).rejects.toThrow(/`hostname` → `host`/);
    expect(store.size).toBe(0);
  });

  it('rejects a name owned by a code-defined datasource', async () => {
    const { service } = makeHarness({
      seed: [{ name: 'crm_primary', driver: 'sqlite', origin: 'code' }],
    });
    await expect(
      service.createDatasource({
        name: 'crm_primary',
        driver: 'postgres',
        config: { database: 'analytics' },
      }),
    ).rejects.toThrow(/code-defined/i);
  });

  it('rejects a duplicate runtime name', async () => {
    const { service } = makeHarness({
      seed: [{ name: 'reporting', driver: 'postgres', origin: 'runtime' }],
    });
    await expect(
      service.createDatasource({
        name: 'reporting',
        driver: 'postgres',
        config: { database: 'analytics' },
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects an invalid name', async () => {
    const { service } = makeHarness();
    await expect(
      service.createDatasource({
        name: 'Bad-Name',
        driver: 'postgres',
        config: { database: 'analytics' },
      }),
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

describe('getDatasource', () => {
  it('returns config + hasSecret with the credentialsRef stripped', async () => {
    const { service } = makeHarness({
      seed: [
        {
          name: 'pg',
          driver: 'postgres',
          origin: 'runtime',
          config: { host: 'db', port: 5432, database: 'app' },
          external: { credentialsRef: 'sys_secret://datasource/pg#1' },
        },
      ],
    });
    const ds = await service.getDatasource('pg');
    expect(ds).toMatchObject({ name: 'pg', driver: 'postgres', origin: 'runtime', hasSecret: true });
    expect(ds!.config).toEqual({ host: 'db', port: 5432, database: 'app' });
    // The opaque credential handle must never be returned.
    expect(JSON.stringify(ds)).not.toContain('sys_secret');
    expect(JSON.stringify(ds)).not.toContain('credentialsRef');
  });

  it('reports hasSecret:false and returns undefined for unknown names', async () => {
    const { service } = makeHarness({
      seed: [{ name: 'lite', driver: 'sqlite', origin: 'runtime', config: { filename: '/tmp/a.db' } }],
    });
    expect((await service.getDatasource('lite'))!.hasSecret).toBe(false);
    expect(await service.getDatasource('missing')).toBeUndefined();
  });
});

// framework#3827 — `status` was the literal 'unvalidated' for every row, so a
// datasource that died at boot looked exactly like a healthy-but-untested one.
describe('listDatasources — status reflects the last connect verdict (framework#3827)', () => {
  function harnessWithStates(
    states: ReadonlyArray<{
      name: string;
      availability: 'available' | 'blocked' | 'failed' | 'unattempted';
      reason?: string;
    }>,
  ) {
    const config: DatasourceAdminServiceConfig = {
      probe: async () => ({ ok: true }),
      listDatasourceRecords: async () => [
        { name: 'live', driver: 'sqlite', origin: 'code' },
        { name: 'dead', driver: 'postgres', origin: 'code' },
        { name: 'denied', driver: 'postgres', schemaMode: 'external', origin: 'code' },
        { name: 'decorative', driver: 'sqlite', origin: 'code' },
      ],
      getDatasourceRecord: async () => undefined,
      putDatasourceRecord: async () => {},
      deleteDatasourceRecord: async () => {},
      writeSecret: async () => 'ref',
      countBoundObjects: async () => 0,
      connectionStates: () => states,
    };
    return new DatasourceAdminService(config);
  }

  it('maps each availability class onto a distinguishable status', async () => {
    const service = harnessWithStates([
      { name: 'live', availability: 'available' },
      { name: 'dead', availability: 'failed', reason: 'connect ECONNREFUSED 10.0.0.4:5432' },
      { name: 'denied', availability: 'blocked', reason: 'plan=free; egress allow-list miss' },
      // 'decorative' has no state at all — the D2 gate never attempted it.
    ]);
    const byName = Object.fromEntries((await service.listDatasources()).map((d) => [d.name, d]));

    expect(byName.live!.status).toBe('ok');
    expect(byName.dead!.status).toBe('error');
    expect(byName.denied!.status).toBe('blocked');
    expect(byName.decorative!.status).toBe('unvalidated');
  });

  it('carries the operator-facing reason for error/blocked only', async () => {
    const service = harnessWithStates([
      { name: 'live', availability: 'available', reason: 'should not be surfaced' },
      { name: 'dead', availability: 'failed', reason: 'connect ECONNREFUSED 10.0.0.4:5432' },
      { name: 'denied', availability: 'blocked', reason: 'plan=free; egress allow-list miss' },
    ]);
    const byName = Object.fromEntries((await service.listDatasources()).map((d) => [d.name, d]));

    // This surface is admin-gated, so the raw cause is the useful answer here —
    // it is the END-USER error that must stay sanitised (#3828).
    expect(byName.dead!.statusReason).toContain('ECONNREFUSED');
    expect(byName.denied!.statusReason).toContain('egress allow-list');
    // A healthy datasource has nothing to explain.
    expect(byName.live!.statusReason).toBeUndefined();
    expect(byName.decorative!.statusReason).toBeUndefined();
  });

  it('an `unattempted` verdict reads the same as no verdict — nobody tried, nothing is known', async () => {
    const service = harnessWithStates([{ name: 'live', availability: 'unattempted', reason: 'no driver factory' }]);
    const live = (await service.listDatasources()).find((d) => d.name === 'live')!;
    expect(live.status).toBe('unvalidated');
    expect(live.statusReason).toBeUndefined();
  });

  it('falls back to `unvalidated` throughout when no connection service is wired', async () => {
    const config: DatasourceAdminServiceConfig = {
      probe: async () => ({ ok: true }),
      listDatasourceRecords: async () => [{ name: 'x', driver: 'sqlite', origin: 'code' }],
      getDatasourceRecord: async () => undefined,
      putDatasourceRecord: async () => {},
      deleteDatasourceRecord: async () => {},
      writeSecret: async () => 'ref',
      countBoundObjects: async () => 0,
      // no `connectionStates`
    };
    const list = await new DatasourceAdminService(config).listDatasources();
    expect(list[0]!.status).toBe('unvalidated');
  });
});

/**
 * `migrateCredential` — the operator-initiated re-homing of a stored cleartext
 * credential into the secret store (#8155).
 *
 * The two hard requirements the card states are asserted directly rather than
 * inferred from a happy path: the credential is durably READABLE from the store
 * before the cleartext is removed, and a re-run never mints a second secret.
 */
describe('migrateCredential (#8155)', () => {
  /** A row written before #8078 closed the write door: cleartext in `config`. */
  const legacyRow = (over: Partial<StoredDatasource> = {}): StoredDatasource => ({
    name: 'warehouse',
    driver: 'postgres',
    origin: 'runtime',
    config: { host: 'db.internal', port: 5432, database: 'app', username: 'app', password: 'hunter2' },
    ...over,
  });

  it('re-homes the credential: secret stored, inline key gone, ref written', async () => {
    const h = makeHarness({ seed: [legacyRow()] });
    const result = await h.service.migrateCredential('warehouse');

    expect(result).toMatchObject({
      name: 'warehouse',
      status: 'migrated',
      migratedKey: 'password',
      reusedExistingSecret: false,
    });

    const stored = h.store.get('warehouse')!;
    expect(stored.config).not.toHaveProperty('password');
    // Everything else about the connection is untouched — this moves a
    // credential, it does not rewrite a datasource.
    expect(stored.config).toEqual({ host: 'db.internal', port: 5432, database: 'app', username: 'app' });
    const ref = stored.external?.credentialsRef;
    expect(ref).toBeTruthy();
    expect(h.secrets.get(ref!)?.value).toBe('hunter2');
    // No cleartext survives anywhere in the persisted record.
    expect(JSON.stringify(stored)).not.toContain('hunter2');
  });

  it('the secret is durably READABLE before the cleartext is removed', async () => {
    // The card's ordering requirement, asserted on the actual call order: the
    // record write that drops the inline key happens last, after a successful
    // read-back of the secret that replaces it. A crash before that write
    // leaves the row working on its inline credential.
    const h = makeHarness({ seed: [legacyRow()] });
    await h.service.migrateCredential('warehouse');
    expect(h.ops).toEqual(['writeSecret', 'readSecret', 'put:warehouse']);
  });

  it('leaves the row untouched when the secret does not read back identically', async () => {
    // A store that accepted the write but cannot return the value is exactly
    // the case that must NOT reach the delete: the connect path is fail-closed
    // on a ref it cannot resolve, so writing one would take a working
    // datasource out of service.
    const h = makeHarness({ seed: [legacyRow()], readBackOverride: async () => undefined });
    const result = await h.service.migrateCredential('warehouse');

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('did not read back');
    expect(result.remedy).toBeTruthy();

    const stored = h.store.get('warehouse')!;
    expect(stored.config?.password).toBe('hunter2');
    expect(stored.external?.credentialsRef).toBeUndefined();
    // …and the secret it minted is taken back out rather than orphaned.
    expect(h.secrets.size).toBe(0);
    expect(h.removedSecrets).toHaveLength(1);
  });

  it('unbinds the freshly-minted secret when the record write fails', async () => {
    let fail = true;
    const h = makeHarness({ seed: [legacyRow()], failPut: () => fail });
    await expect(h.service.migrateCredential('warehouse')).rejects.toThrow('metadata store unavailable');
    fail = false;
    expect(h.secrets.size).toBe(0);
    expect(h.store.get('warehouse')!.config?.password).toBe('hunter2');
  });

  it('is idempotent — a second run binds nothing and writes nothing', async () => {
    const h = makeHarness({ seed: [legacyRow()] });
    const first = await h.service.migrateCredential('warehouse');
    const opsAfterFirst = [...h.ops];

    const second = await h.service.migrateCredential('warehouse');

    expect(first.status).toBe('migrated');
    expect(second).toEqual({ name: 'warehouse', status: 'already-bound' });
    // The failure mode this guards is orphan accumulation (#8103): one secret,
    // however many times an operator clicks.
    expect(h.secrets.size).toBe(1);
    expect(h.ops).toEqual(opsAfterFirst);
  });

  it('finishes a wizard re-entry: drops the inline copy against the EXISTING ref', async () => {
    // The `ref + inline cleartext` state is built through the REAL update path
    // rather than hand-written, because that is how it occurs: the wizard's
    // redacted round-trip carries the stored credential forward by design
    // (`restoreRedactedConfig`), so re-entering a secret on a legacy row leaves
    // the inline copy behind.
    const h = makeHarness({ seed: [legacyRow()] });
    await h.service.updateDatasource(
      'warehouse',
      { config: { host: 'db.internal', port: 5432, database: 'app', username: 'app' } },
      { value: 'hunter2' },
    );
    const beforeMigration = h.store.get('warehouse')!;
    expect(beforeMigration.config?.password).toBe('hunter2');
    expect(beforeMigration.external?.credentialsRef).toBeTruthy();
    expect(h.secrets.size).toBe(1);

    const result = await h.service.migrateCredential('warehouse');

    expect(result).toMatchObject({ status: 'migrated', migratedKey: 'password', reusedExistingSecret: true });
    expect(h.store.get('warehouse')!.config).not.toHaveProperty('password');
    // Same ref, one secret — never a second row for an already-bound datasource.
    expect(h.store.get('warehouse')!.external?.credentialsRef).toBe(beforeMigration.external?.credentialsRef);
    expect(h.secrets.size).toBe(1);
  });

  it('refuses to drop the inline copy when the existing ref cannot be resolved', async () => {
    const h = makeHarness({
      seed: [legacyRow({ external: { credentialsRef: 'sys_secret://gone' } })],
    });
    const result = await h.service.migrateCredential('warehouse');

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('could not be resolved');
    // The inline copy is the only working credential left — it stays.
    expect(h.store.get('warehouse')!.config?.password).toBe('hunter2');
  });

  it('refuses when the host has no readable secret store', async () => {
    const h = makeHarness({ seed: [legacyRow()], noReadSecret: true });
    const result = await h.service.migrateCredential('warehouse');

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('readable secret store');
    expect(h.secrets.size).toBe(0);
    expect(h.store.get('warehouse')!.config?.password).toBe('hunter2');
  });

  it('reports the planner\'s refusals with their remedy, changing nothing', async () => {
    const h = makeHarness({
      seed: [
        legacyRow({ name: 'url_row', config: { url: 'postgresql://app:hunter2@db.internal/app' } }),
        legacyRow({ name: 'code_row', origin: 'code' }),
      ],
    });

    const url = await h.service.migrateCredential('url_row');
    expect(url.status).toBe('refused');
    expect(url.reason).toContain('config.url');
    expect(url.remedy).toContain('secret field');

    const code = await h.service.migrateCredential('code_row');
    expect(code.status).toBe('refused');
    expect(code.reason).toContain('code-defined');

    expect(h.secrets.size).toBe(0);
    expect(h.ops).toEqual([]);
  });

  it('names credential-shaped keys it leaves behind rather than reporting a clean row', async () => {
    const h = makeHarness({
      seed: [legacyRow({ config: { host: 'h', username: 'app', password: 'hunter2', passwd: 'stale' } })],
    });
    const result = await h.service.migrateCredential('warehouse');

    expect(result).toMatchObject({ status: 'migrated', migratedKey: 'password', remaining: ['passwd'] });
    // The alias spelling reaches no connection builder, so it is not bound —
    // and it is not silently deleted either.
    expect(h.store.get('warehouse')!.config?.passwd).toBe('stale');
  });

  it('throws for an unknown datasource — the one arm the route answers 400 for', async () => {
    const h = makeHarness();
    await expect(h.service.migrateCredential('nope')).rejects.toThrow("Datasource 'nope' not found.");
  });
});

/**
 * The contract half the #8153 block was about: the row this migration WRITES
 * must be spec-valid. Before PR #8588 a managed row carrying
 * `external.credentialsRef` failed re-parse, so the migration would have moved
 * rows from "invalid because it holds cleartext" to "invalid because it holds a
 * credentialsRef" while reporting success.
 *
 * Pinned here, against the real `DatasourceSchema`, in both directions — the
 * pre-migration row invalid, the post-migration row valid — because a one-sided
 * assertion would pass just as well on a schema that accepts everything.
 */
describe('migrateCredential produces a spec-valid row (#8153)', () => {
  it('turns a row the schema REFUSES into one it accepts', async () => {
    const before: StoredDatasource = {
      name: 'warehouse',
      driver: 'postgres',
      origin: 'runtime',
      config: { host: 'db.internal', port: 5432, database: 'app', username: 'app', password: 'hunter2' },
    };
    const h = makeHarness({ seed: [before] });

    const beforeParse = DatasourceSchema.safeParse(before);
    expect(beforeParse.success).toBe(false);

    await h.service.migrateCredential('warehouse');

    const after = h.store.get('warehouse')!;
    const afterParse = DatasourceSchema.safeParse(after);
    expect(
      afterParse.success,
      `migrated row still refused: ${afterParse.success ? '' : JSON.stringify(afterParse.error.issues)}`,
    ).toBe(true);
    // The refusal that MUST survive: `credentialsRef` is the only `external`
    // key a managed row may carry, so this is not a blanket allowance.
    expect(
      DatasourceSchema.safeParse({ ...after, external: { ...after.external, allowWrites: true } }).success,
    ).toBe(false);
  });
});
