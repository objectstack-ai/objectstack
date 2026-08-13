// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8030 — **rotating an encrypted setting must actually rotate it.**
 *
 * ## The defect
 *
 * `sys_setting.value_enc` is declared `readonly: true`
 * (`packages/platform-objects/src/system/sys-setting.object.ts`), and the
 * engine strips author-declared read-only columns from a **non-system**
 * caller's UPDATE payload (`stripReadonlyFields`, gated on
 * `if (!opCtx.context?.isSystem)` in `packages/objectql/src/engine.ts`). The
 * INSERT path is deliberately exempt (#3413).
 *
 * `SettingsService` wrote its rows through a plain, un-elevated
 * `engine.update`, so:
 *
 *  - the **first** write of a secret INSERTed, and was correct;
 *  - every **later** write UPDATEd, had `value_enc` stripped out from under
 *    it, and left the handle pointing at the ORIGINAL ciphertext.
 *
 * What made it a P0 rather than a lost write is that **nothing visible said
 * so**: the PUT answered 200 with a correctly redacted body, `updated_at`
 * advanced, an audit row was written, and a genuinely new `sys_secret` row
 * holding the new plaintext was inserted. An admin rotating a leaked SMTP
 * password or provider API key had every reason to believe the leak was
 * closed. It was not — the old credential was still the one in force, and one
 * more decryptable copy of it had just been added to the database (the filer
 * measured `sys_secret` going 7 → 8 → 9 across three writes).
 *
 * ## Why these run against the REAL engine
 *
 * The defect IS the engine's strip rule meeting the platform's own field
 * declaration. A hand-written fake that models "drop read-only keys" proves
 * only that the fake was written to match the fix. So this file boots a real
 * `ObjectQL` over the real `SysSetting` / `SysSecret` schemas and drives the
 * real `SettingsService` through the real `IDataEngine` adapter — the same
 * four pieces the running server bolts together. `vitest.config.ts` aliases
 * `@objectstack/objectql` to its SOURCE so the verdict is about the checkout
 * and not about a prebuilt `dist`.
 *
 * ## What each case measures
 *
 *  1. **the rotation** — a second AND a third PUT of a new value repoint
 *     `value_enc`, and a read-after-write through the service resolves the new
 *     plaintext. Red on `origin/main` at case 1's second write.
 *  2. **the first write is unchanged** — one write still INSERTs one row, one
 *     handle, one `sys_secret` row that decrypts to the value written.
 *  3. **`readonly` still means readonly for everyone else** — the field
 *     declaration is a security control and the fix must not have removed it:
 *     an ordinary (non-system) caller reaching `sys_setting` directly still
 *     cannot repoint a secret handle. This is the case that fails if someone
 *     "fixes" #8030 by deleting `readonly: true`.
 *  4. **the mask-echo no-op** (#7522 / PR #7554) — a PUT carrying `••••••••`
 *     leaves the stored ciphertext BYTE-IDENTICAL. Verified sound by the filer
 *     and explicitly not the cause here, so it is pinned against regression.
 *  5. **no orphans** — three rotations leave exactly one `sys_secret` row, and
 *     the retired ciphertexts are GONE rather than merely unreferenced.
 *  6. **reaping is best-effort** — a store whose `delete` throws still leaves
 *     the rotation landed. The new secret being in force is the property that
 *     matters; the failed cleanup is reported, not raised.
 *  7. **the adapter forwards `context`** — on BOTH of its branches. The
 *     settings row write takes the `multi` one (its `where` is the composite
 *     key, never an `id`), so the by-id branch is the half that would rot
 *     unnoticed.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { dropEchoedSecretMasks, SETTINGS_SECRET_MASK } from './settings-secret-redaction.js';
import type { SettingsSecretStore } from './settings-service.types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_PACKAGE = 'com.objectstack.test.settings-secret-rotation';

/**
 * One encrypted key and one plain one. Deliberately minimal: the shipped
 * manifests carry `visible` expressions and cross-field required rules, and
 * this file is about the storage handle, not about `validatePatch`.
 */
const smsManifest: SettingsManifest = {
  namespace: 'sms',
  version: 1,
  label: 'SMS',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    { type: 'text', key: 'twilio_account_sid', label: 'Account SID', required: false },
    { type: 'password', key: 'twilio_auth_token', label: 'Auth token', required: false, encrypted: true },
  ],
};

type Store = Map<string, Map<string, Record<string, unknown>>>;

/** A driver over plain Maps — enough of `IDataDriver` for the settings write path. */
function makeMemoryDriver() {
  const store: Store = new Map();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => (row[k] ?? null) === (v ?? null));
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return [...rowsOf(object).values()].filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return rowsOf(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = rowsOf(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) rowsOf(object).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/**
 * The four pieces the running server bolts together: a real engine over the
 * real system objects, the real `IDataEngine → SettingsEngine` adapter, the
 * real `sys_secret` store the plugin builds, and the real service.
 *
 * `secretStoreOverrides` lets one case break `delete` without touching the
 * others; `withDelete: false` reproduces a store that cannot reap at all.
 */
async function boot(opts: {
  secretStoreOverrides?: Partial<SettingsSecretStore>;
  withDelete?: boolean;
} = {}) {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysSecret]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }

  const eng: any = engine;
  const baseStore: SettingsSecretStore = {
    async insert(row) {
      await eng.insert('sys_secret', row, { bypassTenantAudit: true });
      return { id: row.id };
    },
    async get(id) {
      const rows = await eng.find('sys_secret', { where: { id }, limit: 1, bypassTenantAudit: true });
      return (Array.isArray(rows) ? rows[0] : null) ?? null;
    },
    async update(id, patch) {
      await eng.update('sys_secret', { id, ...patch }, { bypassTenantAudit: true });
    },
    ...(opts.withDelete === false ? {} : {
      async delete(id: string) {
        await eng.delete('sys_secret', {
          where: { id }, bypassTenantAudit: true, context: { isSystem: true },
        });
      },
    }),
  };

  const logged: string[] = [];
  const svc = new SettingsService({
    env: {},
    engine: wrapEngineAsSettingsEngine(engine as any),
    cryptoProvider: new LocalCryptoProvider(),
    secretStore: { ...baseStore, ...(opts.secretStoreOverrides ?? {}) },
    logger: { error: (m) => { logged.push(m); } },
  });
  svc.registerManifest(smsManifest);

  /** The stored row for `sms.twilio_auth_token`, straight off the driver. */
  const settingRow = () =>
    [...rowsOf('sys_setting').values()].find((r) => r.key === 'twilio_auth_token') as
      Record<string, unknown> | undefined;
  const secretRows = () => [...rowsOf('sys_secret').values()];

  return { engine, svc, settingRow, secretRows, logged };
}

// ---------------------------------------------------------------------------
// 1. The rotation
// ---------------------------------------------------------------------------

describe('#8030 — rotating an encrypted setting repoints sys_setting.value_enc', () => {
  it('a SECOND and THIRD write of a new value take effect', async () => {
    const { svc, settingRow, secretRows } = await boot();

    // Write 1 — the INSERT. Correct on `origin/main` too; this is the baseline
    // the defect hides behind.
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    const handleA = settingRow()?.value_enc as string;
    expect(handleA).toMatch(/^sec_/);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('alpha');

    // Write 2 — the UPDATE. On `origin/main` `value_enc` is still `handleA`
    // here (the read-only strip took it), a new `sys_secret` row holding
    // `beta` exists, and the effective secret is STILL `alpha`.
    await svc.set('sms', 'twilio_auth_token', 'beta');
    const handleB = settingRow()?.value_enc as string;
    expect(handleB).not.toBe(handleA);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('beta');

    // Write 3 — a rotation off a row that was itself written by an UPDATE.
    await svc.set('sms', 'twilio_auth_token', 'gamma');
    const handleC = settingRow()?.value_enc as string;
    expect(handleC).not.toBe(handleB);
    expect(handleC).not.toBe(handleA);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('gamma');

    // The handle in force names the ciphertext that decrypts to the newest
    // value — checked against storage, not against the service's own read.
    const live = secretRows().find((r) => r.id === handleC);
    expect(live).toBeDefined();
    expect(String(live!.ciphertext)).not.toContain('gamma');
  });

  it('resetting to null clears the handle rather than leaving the old secret live', async () => {
    const { svc, settingRow } = await boot();
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    expect(settingRow()?.value_enc).toMatch(/^sec_/);

    await svc.set('sms', 'twilio_auth_token', null);
    expect(settingRow()?.value_enc ?? null).toBeNull();
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. The first write is unchanged
// ---------------------------------------------------------------------------

describe('#8030 — the first-write path is untouched', () => {
  it('one write inserts one row, one handle and one decryptable sys_secret row', async () => {
    const { svc, settingRow, secretRows } = await boot();

    await svc.set('sms', 'twilio_auth_token', 'alpha');

    const row = settingRow();
    expect(row).toBeDefined();
    expect(row!.encrypted).toBe(true);
    expect(row!.value ?? null).toBeNull();
    expect(secretRows()).toHaveLength(1);
    expect(secretRows()[0].id).toBe(row!.value_enc);
    expect(String(secretRows()[0].ciphertext)).not.toContain('alpha');
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('alpha');
  });

  it('a non-encrypted key in the same namespace still round-trips as a plain value', async () => {
    const { svc, secretRows } = await boot();
    await svc.set('sms', 'twilio_account_sid', 'AC1');
    await svc.set('sms', 'twilio_account_sid', 'AC2');
    expect((await svc.get<string>('sms', 'twilio_account_sid')).value).toBe('AC2');
    expect(secretRows()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. `readonly` is still a security control for everybody else
// ---------------------------------------------------------------------------

describe('#8030 — value_enc stays readonly for non-system callers', () => {
  it('an ordinary caller cannot repoint a secret handle through the data layer', async () => {
    const { engine, svc, settingRow } = await boot();
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    const handleA = settingRow()?.value_enc as string;
    const rowId = settingRow()?.id as string;

    // The attack the `readonly: true` flag exists to stop: point the setting
    // at a ciphertext of the attacker's choosing. A NON-system update must
    // still have `value_enc` stripped — the elevation is scoped to
    // SettingsService's own write, not baked into the field declaration.
    await (engine as any).update(
      'sys_setting',
      { id: rowId, value_enc: 'sec_attacker_controlled' },
      { context: { isSystem: false, userId: 'u1' } },
    );

    expect(settingRow()?.value_enc).toBe(handleA);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('alpha');
  });
});

// ---------------------------------------------------------------------------
// 4. The #7522 mask-echo no-op
// ---------------------------------------------------------------------------

describe('#8030 — the mask-echo no-op (#7522 / PR #7554) still holds', () => {
  it('a PUT carrying the mask leaves the stored ciphertext byte-identical', async () => {
    const { svc, settingRow, secretRows } = await boot();
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    const before = { ...settingRow()! };
    const cipherBefore = secretRows().map((r) => String(r.ciphertext));

    // Exactly what the route does: the echoed mask is dropped from the patch
    // BEFORE it reaches the service, so no write happens at all.
    const patch = dropEchoedSecretMasks(
      { twilio_auth_token: SETTINGS_SECRET_MASK, twilio_account_sid: 'AC1' },
      svc.secretKeysOf('sms'),
    );
    expect(patch).not.toHaveProperty('twilio_auth_token');
    await svc.setMany('sms', patch);

    expect(settingRow()!.value_enc).toBe(before.value_enc);
    expect(secretRows().map((r) => String(r.ciphertext))).toEqual(cipherBefore);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('alpha');
    // …and the non-secret key in the same body still landed.
    expect((await svc.get<string>('sms', 'twilio_account_sid')).value).toBe('AC1');
  });
});

// ---------------------------------------------------------------------------
// 5 & 6. Orphan reaping
// ---------------------------------------------------------------------------

describe('#8030 — a rotation leaves no orphan sys_secret rows', () => {
  it('three rotations leave exactly one row, and the retired ciphertexts are gone', async () => {
    const { svc, settingRow, secretRows } = await boot();

    await svc.set('sms', 'twilio_auth_token', 'alpha');
    const handleA = settingRow()?.value_enc as string;
    expect(secretRows()).toHaveLength(1);

    await svc.set('sms', 'twilio_auth_token', 'beta');
    expect(secretRows()).toHaveLength(1);
    expect(secretRows().some((r) => r.id === handleA)).toBe(false);

    await svc.set('sms', 'twilio_auth_token', 'gamma');
    expect(secretRows()).toHaveLength(1);
    expect(secretRows()[0].id).toBe(settingRow()?.value_enc);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('gamma');
  });

  it('a reset clears the handle AND reaps the ciphertext it named', async () => {
    const { svc, secretRows } = await boot();
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    expect(secretRows()).toHaveLength(1);
    await svc.set('sms', 'twilio_auth_token', null);
    expect(secretRows()).toHaveLength(0);
  });

  it('a store with no delete keeps working — the orphans are simply accepted', async () => {
    const { svc, settingRow, secretRows } = await boot({ withDelete: false });
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    await svc.set('sms', 'twilio_auth_token', 'beta');
    // The rotation itself is the invariant; reaping is the optional half.
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('beta');
    expect(settingRow()?.value_enc).toBe(secretRows().find((r) => r.id === settingRow()?.value_enc)?.id);
    expect(secretRows()).toHaveLength(2);
  });

  it('a delete that THROWS does not turn a successful rotation into an error', async () => {
    const { svc, settingRow, logged } = await boot({
      secretStoreOverrides: { delete: vi.fn(async () => { throw new Error('storage offline'); }) },
    });
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    const handleA = settingRow()?.value_enc as string;

    await expect(svc.set('sms', 'twilio_auth_token', 'beta')).resolves.toBeDefined();
    expect(settingRow()?.value_enc).not.toBe(handleA);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('beta');
    // Loud, because "the old credential is gone" is exactly what is not true here.
    expect(logged.join('\n')).toMatch(/could not be deleted from sys_secret/);
    expect(logged.join('\n')).toMatch(/storage offline/);
  });
});

// ---------------------------------------------------------------------------
// 7. The adapter
// ---------------------------------------------------------------------------

describe('#8030 — wrapEngineAsSettingsEngine forwards the execution context', () => {
  it('on the multi branch (the one the settings row write actually takes)', async () => {
    const calls: any[] = [];
    const wrapped = wrapEngineAsSettingsEngine({
      update: async (...args: any[]) => { calls.push(args); },
    } as any);

    await wrapped.update('sys_setting', {
      where: { namespace: 'sms', key: 'twilio_auth_token', scope: 'tenant', user_id: null },
      data: { value_enc: 'sec_new' },
      context: { isSystem: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ multi: true, context: { isSystem: true } });
  });

  it('and on the by-id branch, which no settings write exercises today', async () => {
    const calls: any[] = [];
    const wrapped = wrapEngineAsSettingsEngine({
      update: async (...args: any[]) => { calls.push(args); },
    } as any);

    await wrapped.update('sys_setting', {
      where: { id: 'row_1' },
      data: { value_enc: 'sec_new' },
      bypassTenantAudit: true,
      context: { isSystem: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ id: 'row_1', value_enc: 'sec_new' });
    expect(calls[0][2]).toMatchObject({ bypassTenantAudit: true, context: { isSystem: true } });
  });
});
