// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The datasource-admin doors for a datasource whose driver the platform ships
 * NO config contract for: credential-shaped `config` values (`apiKey`,
 * `client_secret`, `secretAccessKey`, `privateKey`, `accessToken`, a
 * `Password=` connection-string segment) are refused at create/update, are
 * withheld on `getDatasource`, survive an untouched round trip on a legacy row
 * stored before the refusal existed, and are reported as residue by the
 * credential-migration planner instead of `nothing-to-migrate`.
 *
 * The derivation itself is pinned in `@objectstack/spec`
 * (`data/datasource-contractless-credentials.test.ts`); this file pins that the
 * service's doors read it.
 */

import { describe, it, expect } from 'vitest';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import { restoreRedactedConfig } from '../datasource-config-redaction.js';
import { planCredentialMigration } from '../datasource-credential-migration.js';

const DRIVER = 'com.vendor.warehouse';

/** A legacy runtime row stored before the write-door refusal existed. */
const LEGACY: StoredDatasource = {
  name: 'warehouse',
  driver: DRIVER,
  origin: 'runtime',
  config: {
    host: 'wh.internal',
    apiKey: 'sk-live-1',
    oauth: { clientId: 'cid', client_secret: 'cs-1' },
    secretAccessKey: 'sak-1',
    privateKey: 'pk-1',
    accessToken: 'at-1',
    connectionString: 'Server=wh;User Id=u;Password=pw-1;Database=d',
    servers: [{ host: 'a', password: 'srv-1' }, { host: 'b' }],
    headers: [{ name: 'Authorization', value: 'Bearer hdr-1' }, { name: 'Accept', value: 'application/json' }],
  },
};

const CLEARTEXT = ['sk-live-1', 'cs-1', 'sak-1', 'pk-1', 'at-1', 'pw-1', 'srv-1', 'hdr-1'];

function makeService(seed: StoredDatasource[] = []) {
  const records: StoredDatasource[] = seed.map((r) => structuredClone(r));
  const ops: string[] = [];
  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true, latencyMs: 1 }),
    listDatasourceRecords: async () => records.map((r) => structuredClone(r)),
    getDatasourceRecord: async (name) => {
      const r = records.find((x) => x.name === name);
      return r ? structuredClone(r) : undefined;
    },
    putDatasourceRecord: async (record) => {
      ops.push(`put:${record.name}`);
      const idx = records.findIndex((r) => r.name === record.name);
      if (idx >= 0) records[idx] = structuredClone(record);
      else records.push(structuredClone(record));
    },
    deleteDatasourceRecord: async () => {},
    writeSecret: async (_input, hint) => {
      ops.push('writeSecret');
      return `sys_secret:${hint.name}`;
    },
    removeSecret: async () => {
      ops.push('removeSecret');
    },
    countBoundObjects: async () => 0,
    registerPool: () => {},
    unregisterPool: () => {},
  };
  return { service: new DatasourceAdminService(config), records, ops };
}

describe('createDatasource / updateDatasource refuse inline credentials for a contractless driver', () => {
  it.each([
    ['apiKey', { apiKey: 'sk-live-1' }],
    ['client_secret', { client_secret: 'cs-1' }],
    ['secretAccessKey', { secretAccessKey: 'sak-1' }],
    ['privateKey', { privateKey: 'pk-1' }],
    ['accessToken', { accessToken: 'at-1' }],
    ['connectionString', { connectionString: 'Server=wh;Password=pw-1' }],
    ['servers.0.password', { servers: [{ host: 'a', password: 'srv-1' }] }],
    ['headers.0.value', { headers: [{ name: 'Authorization', value: 'Bearer hdr-1' }] }],
  ])('create refuses `config.%s` and persists nothing, no secret minted', async (key, extra) => {
    const { service, records, ops } = makeService();
    await expect(
      service.createDatasource({ name: 'warehouse', driver: DRIVER, config: { host: 'wh', ...extra } }),
    ).rejects.toThrow(`config.${key}`);
    expect(records).toHaveLength(0);
    expect(ops).toEqual([]);
  });

  it('create accepts a contractless config with no credential material, and a bound secret', async () => {
    const { service, records } = makeService();
    await service.createDatasource(
      { name: 'warehouse', driver: DRIVER, config: { host: 'wh', accessKeyId: 'AKIA1' } },
      { value: 'sk-live-1' },
    );
    expect(records[0]?.config).toEqual({ host: 'wh', accessKeyId: 'AKIA1' });
    expect(records[0]?.external?.credentialsRef).toBe('sys_secret:warehouse');
  });

  it('update refuses a NEW inline credential typed into the form', async () => {
    const { service, records } = makeService([
      { name: 'warehouse', driver: DRIVER, origin: 'runtime', config: { host: 'wh' } },
    ]);
    await expect(
      service.updateDatasource('warehouse', { config: { host: 'wh', clientSecret: 'cs-2' } }),
    ).rejects.toThrow('config.clientSecret');
    expect(records[0]?.config).toEqual({ host: 'wh' });
  });
});

describe('getDatasource withholds a legacy contractless row\'s credentials', () => {
  it('serves the row with every credential-shaped value removed, and names nothing it kept', async () => {
    const { service } = makeService([LEGACY]);
    const ds = await service.getDatasource('warehouse');
    expect(ds?.config).toEqual({
      host: 'wh.internal',
      oauth: { clientId: 'cid' },
      connectionString: 'Server=wh;User Id=u;Database=d',
      servers: [{ host: 'a' }, { host: 'b' }],
      headers: [{ name: 'Authorization' }, { name: 'Accept', value: 'application/json' }],
    });
    const served = JSON.stringify(ds);
    for (const secret of CLEARTEXT) expect(served).not.toContain(secret);
  });

  it('listDatasources serves no cleartext either', async () => {
    const { service } = makeService([LEGACY]);
    const served = JSON.stringify(await service.listDatasources());
    for (const secret of CLEARTEXT) expect(served).not.toContain(secret);
  });
});

describe('the edit round trip on a legacy row', () => {
  it('restoreRedactedConfig carries every withheld value forward (an untouched Save deletes nothing)', () => {
    // Exactly what getDatasource served for the row (pinned above).
    const patch = {
      host: 'wh.internal',
      oauth: { clientId: 'cid' },
      connectionString: 'Server=wh;User Id=u;Database=d',
      servers: [{ host: 'a' }, { host: 'b' }],
      headers: [{ name: 'Authorization' }, { name: 'Accept', value: 'application/json' }],
    };
    expect(restoreRedactedConfig(DRIVER, patch, LEGACY.config)).toEqual(LEGACY.config);
    // The patch's own arrays are copied, never mutated.
    expect(patch.servers).toEqual([{ host: 'a' }, { host: 'b' }]);
  });

  it('a `[name, value]` header tuple and a credential embedded with a `;` round-trip too', async () => {
    const stored: StoredDatasource = {
      name: 'tuples',
      driver: DRIVER,
      origin: 'runtime',
      config: {
        headers: [['Accept', 'application/json'], ['Authorization', 'Bearer tpl-1']],
        libpq: 'host=wh password=lp-1;x dbname=d',
      },
    };
    const { service, records } = makeService([stored]);
    const read = await service.getDatasource('tuples');
    expect(read!.config).toEqual({ headers: [['Accept', 'application/json'], ['Authorization']], libpq: 'host=wh dbname=d' });
    expect(JSON.stringify(read)).not.toMatch(/tpl-1|lp-1/);
    await service.updateDatasource('tuples', { config: read!.config });
    expect(records[0]!.config).toEqual(stored.config);
  });

  it('an author who changed an array element keeps their word; one who removed the array keeps it removed', () => {
    const changed = { host: 'wh.internal', servers: [{ host: 'a', password: 'new-1' }, { host: 'b' }] };
    const restored = restoreRedactedConfig(DRIVER, changed, LEGACY.config) as Record<string, any>;
    expect(restored.servers).toEqual([{ host: 'a', password: 'new-1' }, { host: 'b' }]);
    const removed = restoreRedactedConfig(DRIVER, { host: 'wh.internal' }, LEGACY.config) as Record<string, any>;
    expect(removed.servers).toBeUndefined();
  });
});

describe('a withheld array value is carried only onto the element it came from', () => {
  const STORED = {
    servers: [{ host: 'a', password: 'p-a' }, { host: 'b', password: 'p-b' }],
    headers: [{ name: 'Authorization', value: 'Bearer h-1' }, { name: 'Accept', value: 'application/json' }],
    tuples: [['Accept', 'json'], ['Authorization', 'Bearer t-1']],
  };
  /** What getDatasource serves for STORED. */
  const SERVED = {
    servers: [{ host: 'a' }, { host: 'b' }],
    headers: [{ name: 'Authorization' }, { name: 'Accept', value: 'application/json' }],
    tuples: [['Accept', 'json'], ['Authorization']],
  };
  const restore = (patch: Record<string, unknown>) => restoreRedactedConfig(DRIVER, patch, STORED) as Record<string, unknown>;

  it('control: the served config round-trips to the stored one', () => {
    expect(restore(structuredClone(SERVED))).toEqual(STORED);
  });

  it('an element deleted before it: each remaining server keeps ITS OWN password', () => {
    expect(restore({ ...structuredClone(SERVED), servers: [{ host: 'b' }] }).servers).toEqual([{ host: 'b', password: 'p-b' }]);
  });

  it('a reorder: every value follows its element', () => {
    const out = restore({
      servers: [{ host: 'b' }, { host: 'a' }],
      headers: [{ name: 'Accept', value: 'application/json' }, { name: 'Authorization' }],
      tuples: [['Authorization'], ['Accept', 'json']],
    });
    expect(out).toEqual({
      servers: [{ host: 'b', password: 'p-b' }, { host: 'a', password: 'p-a' }],
      headers: [{ name: 'Accept', value: 'application/json' }, { name: 'Authorization', value: 'Bearer h-1' }],
      tuples: [['Authorization', 'Bearer t-1'], ['Accept', 'json']],
    });
  });

  it('a renamed header, or an edited sibling field, receives nothing — the value is dropped', () => {
    const out = restore({
      servers: [{ host: 'a2' }, { host: 'b' }],
      headers: [{ name: 'X-Other' }, { name: 'Accept', value: 'application/json' }],
      tuples: [['Accept', 'json'], ['X-Other']],
    });
    expect(out).toEqual({
      servers: [{ host: 'a2' }, { host: 'b', password: 'p-b' }],
      headers: [{ name: 'X-Other' }, { name: 'Accept', value: 'application/json' }],
      tuples: [['Accept', 'json'], ['X-Other']],
    });
    expect(JSON.stringify(out)).not.toMatch(/p-a|h-1|t-1/);
  });

  it('elements that cannot be told apart receive nothing once the array was edited; untouched, they keep their values', () => {
    const stored = {
      headers: [
        { name: 'Authorization', value: 'v-1' },
        { name: 'Authorization', value: 'v-2' },
        { name: 'Accept', value: 'json' },
      ],
    };
    const served = { headers: [{ name: 'Authorization' }, { name: 'Authorization' }, { name: 'Accept', value: 'json' }] };
    expect(restoreRedactedConfig(DRIVER, structuredClone(served), stored)).toEqual(stored);
    const edited = restoreRedactedConfig(DRIVER, { headers: [{ name: 'Authorization' }, { name: 'Authorization' }] }, stored);
    expect(edited).toEqual({ headers: [{ name: 'Authorization' }, { name: 'Authorization' }] });
  });

  it('a raw-headers list: its withheld value comes back only into the untouched list', () => {
    const stored = { headers: ['Authorization', 'Bearer r-1', 'Accept', 'json'] };
    expect(restoreRedactedConfig(DRIVER, { headers: ['Authorization', null, 'Accept', 'json'] }, stored)).toEqual(stored);
    expect(restoreRedactedConfig(DRIVER, { headers: ['Authorization', null, 'Accept', 'xml'] }, stored)).toEqual({
      headers: ['Authorization', null, 'Accept', 'xml'],
    });
  });

  it('through the service: deleting the first server keeps the second server\'s password on it', async () => {
    const { service, records } = makeService([{ name: 'w', driver: DRIVER, origin: 'runtime', config: structuredClone(STORED) }]);
    const read = await service.getDatasource('w');
    const config = structuredClone(read!.config) as Record<string, unknown>;
    config.servers = (config.servers as unknown[]).slice(1);
    await service.updateDatasource('w', { config });
    expect(records[0]!.config?.servers).toEqual([{ host: 'b', password: 'p-b' }]);
  });
});

describe('planCredentialMigration names a contractless row\'s credentials as residue', () => {
  it('refuses with a remedy instead of reporting nothing-to-migrate', () => {
    const plan = planCredentialMigration({
      name: 'warehouse',
      driver: DRIVER,
      origin: 'runtime',
      config: { host: 'wh', apiKey: 'sk-live-1', connectionString: 'Server=wh;Password=pw-1' },
    });
    expect(plan.action).toBe('refuse');
    expect(plan.action === 'refuse' ? plan.reason : '').toContain('config.apiKey');
    expect(plan.action === 'refuse' ? plan.reason : '').toContain('config.connectionString');
  });

  it('control: a contractless row with no credential material has nothing to migrate', () => {
    const plan = planCredentialMigration({
      name: 'warehouse',
      driver: DRIVER,
      origin: 'runtime',
      config: { host: 'wh', accessKeyId: 'AKIA1' },
    });
    expect(plan).toEqual({ action: 'none', status: 'nothing-to-migrate', remaining: [] });
  });
});
