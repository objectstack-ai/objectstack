// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27721 — pins for the report-only holder pass over the reference union.
 *
 * Every handle below is minted by the producer that really mints it — the REAL
 * `ObjectQL` write path for a `secret` field (a predicate update included), the
 * REAL `LocalCryptoProvider` for the settings rows and the REAL datasource
 * binder — and the union that reads them back is the REAL collector, over a
 * minimal in-memory driver double. The two out-of-place refs are copied the
 * only way a ref still moves: a system-principal write, which passes a ref
 * through as written.
 *
 * The predicate-update share is the pin the card turns on: the engine itself
 * writes one handle onto two rows here, and the report must list that share
 * apart from `shared` and `misplaced`, not inside them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { createDatasourceSecretBinder } from '@objectstack/service-datasource';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import {
  buildSecretReferenceUnion,
  collectSecretReferenceUnion,
  type SecretReferenceEngineLike,
} from './secret-reference-union.js';
import { reportSysSecretHolders, type SysSecretHolderReport } from './sys-secret-holder-report.js';

type Row = Record<string, unknown>;

/**
 * An in-memory driver double: the reads the union makes, and the writes the
 * engine's secret-field path makes (insert, by-id and predicate update, and the
 * release of a retired handle).
 */
function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (object: string) => {
    let s = stores.get(object);
    if (!s) { s = new Map(); stores.set(object, s); }
    return s;
  };
  // Scalar equality and `$in` only. Any other operator, and every combinator,
  // is refused rather than answered wrong.
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k.startsWith('$')) throw new Error(`driver double: combinator ${k} is not implemented`);
      if (v && typeof v === 'object') {
        const ops = Object.keys(v as Row);
        if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`driver double: operator ${ops.join(',')} is not implemented`);
        if (!((v as { $in: unknown[] }).$in).includes(row[k])) return false;
        continue;
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const copy = (r: Row): Row => ({ ...r });
  let n = 0;

  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async syncSchema() {},
    async find(object: string, ast?: Row) {
      const matched = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound by PRESENCE, after the filter and before the copy.
      const page = typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
      return page.map(copy);
    },
    async findOne(object: string, ast?: Row) { return (await this.find(object, ast))[0] ?? null; },
    async create(object: string, data: Row) {
      n += 1;
      const row = { ...data, id: (data.id as string) ?? `${object}_${n}` };
      storeFor(object).set(String(row.id), row);
      return copy(row);
    },
    async update(object: string, id: string, data: Row) {
      const row = { ...storeFor(object).get(String(id)), ...data, id };
      storeFor(object).set(String(id), row);
      return copy(row);
    },
    async updateMany(object: string, ast: Row | undefined, data: Row) {
      let k = 0;
      for (const [id, row] of storeFor(object)) {
        if (!matches(row, ast?.where)) continue;
        storeFor(object).set(id, { ...row, ...data, id });
        k += 1;
      }
      return k;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(String(id)); },
    async count(object: string, ast?: Row) { return (await this.find(object, ast)).length; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };

  return {
    driver,
    seed(object: string, row: Row) { storeFor(object).set(String(row.id), { ...row }); },
    rowsOf(object: string) { return Array.from(storeFor(object).values()).map(copy); },
  };
}

const TEST_PACKAGE_ID = 'com.objectstack.test.27721';
const text = (name: string) => ({ name, label: name, type: 'text' as const });
const secret = (name: string) => ({ name, label: name, type: 'secret' as const });
const objectOf = (name: string, fields: string[], secrets: string[] = []) => ({
  name,
  label: name,
  fields: {
    ...Object.fromEntries(fields.map((f) => [f, text(f)])),
    ...Object.fromEntries(secrets.map((f) => [f, secret(f)])),
  },
});

/** Distinctive plaintexts, so their absence from the report means something. */
const PLAIN = {
  r1: 'pt-27721-vault-r1',
  r2: 'pt-27721-vault-r2',
  r3: 'pt-27721-vault-r3',
  r4: 'pt-27721-vault-r4',
  predicate: 'pt-27721-predicate-shared',
  mailPassword: 'pt-27721-mail-password',
  mailToken: 'pt-27721-mail-token',
  datasource: 'pt-27721-datasource',
} as const;

const SYSTEM = { context: { isSystem: true } } as never;

async function buildRuntime() {
  const store = makeDriver();
  const engine = new ObjectQL();
  engine.registerDriver(store.driver as never, true);
  await engine.init();
  const objects = [
    objectOf('sys_secret', ['id', 'namespace', 'key', 'kms_key_id', 'alg', 'ciphertext', 'created_at', 'rotated_at', 'version']),
    objectOf('sys_setting', ['id', 'namespace', 'key', 'scope', 'user_id', 'value', 'value_enc']),
    objectOf('sys_platform_setting', ['id', 'namespace', 'key', 'value', 'value_enc']),
    objectOf('sys_metadata', ['id', 'name', 'type', 'scope', 'metadata', 'state']),
    objectOf('vault', ['id', 'tier'], ['token']),
    objectOf('ledger', ['id'], ['api_key']),
  ];
  for (const object of objects) engine.registry.registerObject(object as never, TEST_PACKAGE_ID);
  const crypto = new LocalCryptoProvider({ mode: 'test' });
  engine.setCryptoProvider(crypto as never);

  const handleOf = (object: string, id: string, field: string) => {
    const value = store.rowsOf(object).find((r) => r.id === id)?.[field];
    return String(value).slice('secret:'.length);
  };
  const seedSettingsSecret = async (namespace: string, key: string, plain: string) => {
    const handle = await crypto.encrypt(plain, { scope: 'settings', namespace, key });
    store.seed('sys_secret', {
      id: handle.id, namespace, key, kms_key_id: handle.kmsKeyId,
      alg: handle.alg, version: handle.version, ciphertext: handle.ciphertext,
    });
    return handle.id;
  };

  // The engine's own channel: four records, each sealing its own handle.
  await engine.insert('vault', { id: 'r1', tier: 'gold', token: PLAIN.r1 });
  await engine.insert('vault', { id: 'r2', tier: 'gold', token: PLAIN.r2 });
  await engine.insert('vault', { id: 'r3', tier: 'silver', token: PLAIN.r3 });
  await engine.insert('vault', { id: 'r4', tier: 'silver', token: PLAIN.r4 });
  // [#27495] A REAL predicate update: one value sealed once, its ref written
  // onto every row the predicate matched.
  await engine.update('vault', { token: PLAIN.predicate }, { where: { tier: 'gold' }, multi: true } as never);

  // One settings handle that two settings rows name.
  const settingsShared = await seedSettingsSecret('mail', 'smtp_password', PLAIN.mailPassword);
  store.seed('sys_setting', { id: 'set_a', namespace: 'mail', key: 'smtp_password', scope: 'tenant', user_id: null, value_enc: settingsShared });
  store.seed('sys_setting', { id: 'set_b', namespace: 'mail', key: 'smtp_password', scope: 'user', user_id: 'u1', value_enc: settingsShared });

  // r3's handle, copied onto another object's column by a system write.
  await engine.insert('ledger', { id: 'l1', api_key: `secret:${handleOf('vault', 'r3', 'token')}` }, SYSTEM);
  // A settings-minted handle no settings row names, held only by a business column.
  const mailToken = await seedSettingsSecret('mail', 'api_token', PLAIN.mailToken);
  await engine.insert('ledger', { id: 'l2', api_key: `secret:${mailToken}` }, SYSTEM);

  // The datasource binder, through its default pair.
  const binder = createDatasourceSecretBinder({ engine: engine as never, cryptoProvider: crypto as never });
  const credentialsRef = await binder.bind({ value: PLAIN.datasource }, { name: 'main' });
  store.seed('sys_metadata', {
    id: 'meta_1', name: 'main', type: 'datasource', scope: 'platform', state: 'active',
    metadata: JSON.stringify({ name: 'main', driver: 'postgres', external: { credentialsRef } }),
  });

  return {
    engine: engine as unknown as SecretReferenceEngineLike,
    store,
    ids: {
      predicate: handleOf('vault', 'r1', 'token'),
      r3: handleOf('vault', 'r3', 'token'),
      r4: handleOf('vault', 'r4', 'token'),
      settingsShared,
      mailToken,
      datasource: credentialsRef.slice('sys_secret:'.length),
    },
  };
}

type Runtime = Awaited<ReturnType<typeof buildRuntime>>;

const secretsOf = (rt: Runtime) => rt.store.rowsOf('sys_secret').map((r) => ({
  id: String(r.id), namespace: String(r.namespace), key: String(r.key),
}));

async function reportOf(rt: Runtime): Promise<SysSecretHolderReport> {
  const union = await collectSecretReferenceUnion({ engine: rt.engine, declaredDatasources: [] });
  expect(union.complete).toBe(true);
  return reportSysSecretHolders({ secrets: secretsOf(rt), union });
}

const idsIn = (list: SysSecretHolderReport['shared']) => list.map((f) => f.id);

describe('sys_secret holder report — the fixture is what the producers wrote', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('the predicate update really wrote ONE handle onto both rows it matched', () => {
    const rows = rt.store.rowsOf('vault');
    const ref = (id: string) => rows.find((r) => r.id === id)?.token;
    expect(ref('r1')).toBe(`secret:${rt.ids.predicate}`);
    expect(ref('r2')).toBe(ref('r1'));
    // …and the handle it replaced on each row is gone, so the share is the only one.
    expect(new Set(Object.values(rt.ids)).size).toBe(Object.values(rt.ids).length);
    expect(rt.store.rowsOf('sys_secret').map((r) => r.id)).toContain(rt.ids.predicate);
  });
});

describe('shared — a handle named by more than one holder record', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('lists the settings handle two settings rows name, with the count and each holder object/field', async () => {
    const report = await reportOf(rt);
    const finding = report.shared.find((f) => f.id === rt.ids.settingsShared);
    expect(finding).toBeDefined();
    expect(finding!.holderCount).toBe(2);
    expect(finding!.holders.map((h) => [h.object, h.field, h.record, h.placement])).toEqual([
      ['sys_setting', 'value_enc', 'set_a', 'in_place'],
      ['sys_setting', 'value_enc', 'set_b', 'in_place'],
    ]);
    // Both rows are the column its pair names, so it is shared and not misplaced.
    expect(idsIn(report.misplaced)).not.toContain(rt.ids.settingsShared);
  });

  it('lists a handle two different columns name', async () => {
    const report = await reportOf(rt);
    const finding = report.shared.find((f) => f.id === rt.ids.r3);
    expect(finding?.holderCount).toBe(2);
    expect(finding?.holders.map((h) => h.holder).sort()).toEqual(['ledger.api_key#l1', 'vault.token#r3']);
  });

  it('a handle one holder names is not shared (control)', async () => {
    const report = await reportOf(rt);
    for (const id of [rt.ids.r4, rt.ids.mailToken, rt.ids.datasource]) {
      expect(idsIn(report.shared)).not.toContain(id);
      expect(idsIn(report.sharedInOwnColumn)).not.toContain(id);
    }
  });
});

describe('misplaced — a holder column that is not the column the handle\'s (namespace, key) names', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('lists the copied handle, naming the holder out of place and the one in place', async () => {
    const report = await reportOf(rt);
    const finding = report.misplaced.find((f) => f.id === rt.ids.r3);
    expect(finding).toMatchObject({ namespace: 'vault', key: 'token' });
    expect(finding!.holders.map((h) => [h.holder, h.placement]).sort()).toEqual([
      ['ledger.api_key#l1', 'misplaced'],
      ['vault.token#r3', 'in_place'],
    ]);
  });

  it('lists a handle whose ONLY holder is out of place — another producer\'s pair on a business column', async () => {
    const report = await reportOf(rt);
    const finding = report.misplaced.find((f) => f.id === rt.ids.mailToken);
    expect(finding).toMatchObject({ namespace: 'mail', key: 'api_token', holderCount: 1 });
    expect(finding!.holders).toEqual([
      expect.objectContaining({ family: 'object-field', object: 'ledger', field: 'api_key', record: 'l2', placement: 'misplaced' }),
    ]);
  });

  it('a handle held by its own column is not misplaced (control)', async () => {
    const report = await reportOf(rt);
    expect(idsIn(report.misplaced)).not.toContain(rt.ids.r4);
    expect(idsIn(report.misplaced).sort()).toEqual([rt.ids.r3, rt.ids.mailToken].sort());
  });

  it('a datasource holder is not judged: the binder records the pair its caller passes', async () => {
    const report = await reportOf(rt);
    expect(idsIn(report.misplaced)).not.toContain(rt.ids.datasource);
    expect(report.counts.placementNotJudged).toBe(1);
    expect(report.notes.some((n) => n.includes('not judged for placement'))).toBe(true);
  });
});

describe('the predicate-update share (#27495) is listed apart', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('lists the share the engine wrote under sharedInOwnColumn, and in neither other class', async () => {
    const report = await reportOf(rt);
    const finding = report.sharedInOwnColumn.find((f) => f.id === rt.ids.predicate);
    expect(finding).toBeDefined();
    expect(finding!.holderCount).toBe(2);
    expect(finding!.holders.map((h) => [h.holder, h.placement])).toEqual([
      ['vault.token#r1', 'in_place'],
      ['vault.token#r2', 'in_place'],
    ]);
    expect(idsIn(report.shared)).not.toContain(rt.ids.predicate);
    expect(idsIn(report.misplaced)).not.toContain(rt.ids.predicate);
  });

  it('says how it tells the case apart', async () => {
    const report = await reportOf(rt);
    expect(report.notes.some((n) => n.startsWith('Told apart:'))).toBe(true);
  });

  it('a share across settings rows is not given the predicate-update exemption', async () => {
    // The settings producer seals one handle per row write: only the engine's
    // secret-field channel writes one handle onto several rows.
    const report = await reportOf(rt);
    expect(idsIn(report.sharedInOwnColumn)).toEqual([rt.ids.predicate]);
  });
});

describe('counts, and what never leaves the report', () => {
  let rt: Runtime;
  beforeEach(async () => { rt = await buildRuntime(); });

  it('counts each class by handle', async () => {
    const report = await reportOf(rt);
    expect(report.counts).toEqual({
      total: rt.store.rowsOf('sys_secret').length,
      named: 6,
      shared: 2,
      misplaced: 2,
      sharedInOwnColumn: 1,
      placementNotJudged: 1,
    });
  });

  it('carries no plaintext and no cipher material, and writes nothing', async () => {
    const before = JSON.stringify(rt.store.rowsOf('sys_secret'));
    const report = await reportOf(rt);
    const printed = JSON.stringify(report);

    for (const plain of Object.values(PLAIN)) expect(printed).not.toContain(plain);
    const ciphertexts = rt.store.rowsOf('sys_secret').map((r) => String(r.ciphertext));
    // Anti-vacuity: there IS cipher material in the store to leak.
    expect(ciphertexts.length).toBeGreaterThan(0);
    for (const cipher of ciphertexts) expect(printed).not.toContain(cipher);
    expect(printed).not.toMatch(/ciphertext/i);

    expect(JSON.stringify(rt.store.rowsOf('sys_secret'))).toBe(before);
  });

  it('an incomplete union is reported on what was enumerated, and names the missing family', () => {
    const union = buildSecretReferenceUnion({
      settings: { family: 'settings', status: 'enumerated', references: [] },
      'object-field': {
        family: 'object-field',
        status: 'gap',
        reason: 'reading secret field(s) of `vault` threw — Error: table is locked',
        references: [
          { handleId: 'sec_x', family: 'object-field', holder: 'vault.token#r1', column: { object: 'vault', field: 'token', record: 'r1', mintedPair: { namespace: 'vault', key: 'token' } } },
          { handleId: 'sec_x', family: 'object-field', holder: 'ledger.api_key#l1', column: { object: 'ledger', field: 'api_key', record: 'l1', mintedPair: { namespace: 'ledger', key: 'api_key' } } },
        ],
      },
      datasource: { family: 'datasource', status: 'enumerated', references: [] },
    });
    const report = reportSysSecretHolders({ secrets: [{ id: 'sec_x', namespace: 'vault', key: 'token' }], union });
    expect(idsIn(report.shared)).toEqual(['sec_x']);
    expect(idsIn(report.misplaced)).toEqual(['sec_x']);
    expect(report.notes.some((n) => n.includes('incomplete') && n.includes('object-field'))).toBe(true);
  });
});
