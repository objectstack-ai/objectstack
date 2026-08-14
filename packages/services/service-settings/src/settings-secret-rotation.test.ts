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
// `assertEngineUpdateDispatch` re-exports the shared producer-side predicate
// (`@objectstack/metadata-core` since #5619) through objectql, which is already
// a devDependency here and already aliased to SOURCE by `vitest.config.ts` — so
// the #8262 doubles below stay pinned to the real dispatch contract without
// adding a dependency or an alias.
import { assertEngineUpdateDispatch, ObjectQL } from '@objectstack/objectql';
import { SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { dropEchoedSecretMasks, SETTINGS_SECRET_MASK } from './settings-secret-redaction.js';
import type { SettingsEngine, SettingsSecretStore } from './settings-service.types.js';

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
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
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
 * [#8262] Reproduces the adapter the `SettingsEngine` doc comment warns about:
 * identical to `wrapEngineAsSettingsEngine` except that it DROPS `context` on
 * the way to the engine.
 *
 * That single omission is the whole hazard — `sys_setting.value_enc` is
 * declared `readonly: true` and the engine strips author-declared read-only
 * columns from a NON-system caller's UPDATE (`stripReadonlyFields`, gated on
 * `context.isSystem`), while the INSERT path is exempt (#3413). It is a
 * documented extension point, so the population that reaches it is real:
 * third-party adapter authors, who have no other discovery path.
 */
function wrapEngineDroppingContext(engine: any): SettingsEngine {
  const real = wrapEngineAsSettingsEngine(engine);
  return {
    find: real.find.bind(real),
    insert: real.insert.bind(real),
    async update(objectName, opts) {
      // Loose in exactly ONE dimension — `context` — and conformant in every
      // other, or the row states it produces stop being evidence about the
      // real engine. `multi: true` is passed unconditionally because that IS
      // the settings adapter's contract (a scalar `where.id` outranks `multi`
      // in the shared predicate, and the settings row write never has one).
      assertEngineUpdateDispatch((opts as any)?.data ?? {}, {
        where: (opts as any)?.where,
        multi: true,
      });
      const { context: _dropped, ...withoutContext } = opts as any;
      return real.update(objectName, withoutContext);
    },
  };
}

/**
 * [#8262] Forwards `context` correctly, but makes the FIRST read after any
 * update throw — which is exactly the reaper's post-write verification read.
 *
 * The constraint this exists to pin: `reapRotatedSecret` runs after the write
 * has committed and is "never allowed to fail the write" (its call site says
 * so). Adding a read to it must not turn a transient read failure into a
 * failed rotation.
 */
function wrapEngineFailingPostUpdateReads(engine: any): SettingsEngine {
  const real = wrapEngineAsSettingsEngine(engine);
  let armed = false;
  return {
    async find(objectName, opts) {
      if (armed) {
        armed = false;
        throw new Error('read replica offline');
      }
      return real.find(objectName, opts);
    },
    insert: real.insert.bind(real),
    async update(objectName, opts) {
      assertEngineUpdateDispatch((opts as any)?.data ?? {}, {
        where: (opts as any)?.where,
        multi: true,
      });
      const res = await real.update(objectName, opts);
      armed = true;
      return res;
    },
  };
}

/**
 * The four pieces the running server bolts together: a real engine over the
 * real system objects, the real `IDataEngine → SettingsEngine` adapter, the
 * real `sys_secret` store the plugin builds, and the real service.
 *
 * `secretStoreOverrides` lets one case break `delete` without touching the
 * others; `withDelete: false` reproduces a store that cannot reap at all;
 * `forwardContext: false` / `failVerificationRead` swap in the two #8262
 * adapters above.
 */
async function boot(opts: {
  secretStoreOverrides?: Partial<SettingsSecretStore>;
  withDelete?: boolean;
  forwardContext?: boolean;
  failVerificationRead?: boolean;
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
    engine: opts.failVerificationRead
      ? wrapEngineFailingPostUpdateReads(engine)
      : opts.forwardContext === false
        ? wrapEngineDroppingContext(engine)
        : wrapEngineAsSettingsEngine(engine as any),
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

// ---------------------------------------------------------------------------
// 8. #8262 — the reaper VERIFIES the repoint instead of inferring it
// ---------------------------------------------------------------------------

/**
 * #8262 — `reapRotatedSecret` deleted the handle `upsertRow` reported as
 * `previousEnc` without ever confirming the repoint it was cleaning up after
 * had taken effect; it inferred that from `previousEnc !== nextEnc`.
 *
 * That inference holds for the shipped adapter (which forwards
 * `context: { isSystem: true }`) and fails for one that drops it — the reader
 * `SettingsEngine`'s own doc comment contemplates. With `context` dropped the
 * UPDATE has `value_enc` stripped, so the row still names `previousEnc`, and
 * the reaper deleted **the ciphertext still in force**: `materialiseRow`
 * dereferences a dangling handle, gets nothing, and the setting silently reads
 * empty. Unrecoverable — the audit trail records digests, never handles.
 *
 * Before the reaper existed the same adapter bug was non-destructive (the
 * rotated-away credential merely stayed in force). These cases pin that the
 * failure mode is back to recoverable, and now LOUD rather than silent.
 *
 * ⚠️ Direction of the counterfactual: on the pre-fix source, `three writes`
 * below reads `[1, 1, 2]` and the value reads back `null`. The fix does not
 * make a context-dropping adapter correct — nothing at this layer can, the
 * repoint is stripped one layer down — it makes the failure survivable.
 * Sections 5 and 6 are the other half of the pin: with `context` forwarded,
 * the verification passes and reaping still happens on every rotation, so a
 * fix that simply stopped reaping would go red there.
 */
describe('#8262 — the reaper never deletes the ciphertext that is still in force', () => {
  it('a context-dropping adapter keeps the in-force ciphertext, and the setting still reads', async () => {
    const { svc, settingRow, secretRows } = await boot({ forwardContext: false });

    await svc.set('sms', 'twilio_auth_token', 'alpha');
    const handleA = settingRow()?.value_enc as string;
    expect(handleA).toMatch(/^sec_/);
    expect(secretRows()).toHaveLength(1);

    // The second write is where the defect lived: the repoint is stripped, so
    // `value_enc` still names `handleA`, while `upsertRow` reports it as the
    // handle rotated AWAY from.
    await svc.set('sms', 'twilio_auth_token', 'beta');

    // The strip itself is NOT this card's subject and is unchanged: the row
    // still names the old handle. What must never happen is the deletion.
    expect(settingRow()?.value_enc).toBe(handleA);

    // ⛔ THE assertion. Pre-fix this row was gone and `value_enc` dangled.
    expect(secretRows().some((r) => r.id === handleA)).toBe(true);

    // …and the consequence that makes it data loss rather than a stale value:
    // pre-fix this read returned `null` with the credential unrecoverable.
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('alpha');
  });

  it('three writes leave the recoverable pre-reaper shape (1→2→3), not the destructive one (1→1→2)', async () => {
    const { svc, settingRow, secretRows } = await boot({ forwardContext: false });

    await svc.set('sms', 'twilio_auth_token', 'tok-1');
    const pinned = settingRow()?.value_enc as string;
    const afterFirst = secretRows().length;

    await svc.set('sms', 'twilio_auth_token', 'tok-2');
    const afterSecond = secretRows().length;

    await svc.set('sms', 'twilio_auth_token', 'tok-3');
    const afterThird = secretRows().length;

    // The card's table, inverted. `[1, 1, 2]` is the destructive shape: the
    // second write deleted the row the setting pointed at.
    expect([afterFirst, afterSecond, afterThird]).toEqual([1, 2, 3]);
    expect(settingRow()?.value_enc).toBe(pinned);
    expect(secretRows().some((r) => r.id === pinned)).toBe(true);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('tok-1');
  });

  it('says so LOUDLY — the failure the adapter doc calls silent now names itself', async () => {
    const { svc, logged } = await boot({ forwardContext: false });
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    await svc.set('sms', 'twilio_auth_token', 'beta');

    const out = logged.join('\n');
    // The operator's question is "did my rotation happen?", so the message has
    // to answer that, name the row, and name the cause.
    expect(out).toMatch(/did NOT take effect/);
    expect(out).toMatch(/sms\.twilio_auth_token/);
    expect(out).toMatch(/context/);
    // It must be a refusal, not a report of something already destroyed.
    expect(out).toMatch(/REFUSED to delete/);
  });

  it('a verification read that THROWS still leaves the rotation landed (never fails the write)', async () => {
    const { svc, settingRow, secretRows, logged } = await boot({ failVerificationRead: true });

    await svc.set('sms', 'twilio_auth_token', 'alpha');
    const handleA = settingRow()?.value_enc as string;

    // The write itself must survive a reaper that cannot verify — the call
    // site's "never allowed to fail the write" constraint covers the read the
    // fix added, not just the delete.
    await expect(svc.set('sms', 'twilio_auth_token', 'beta')).resolves.toBeDefined();

    // The rotation landed (context IS forwarded here) …
    const handleB = settingRow()?.value_enc as string;
    expect(handleB).not.toBe(handleA);
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('beta');

    // … and the unverifiable handle was left alone rather than destroyed on a
    // guess. An orphan is recoverable; a deleted in-force ciphertext is not.
    expect(secretRows().some((r) => r.id === handleA)).toBe(true);
    expect(logged.join('\n')).toMatch(/could not confirm/);
  });

  it('a store with no delete is unaffected — no verification read is issued at all', async () => {
    // The verification read costs one I/O and must only be paid where a
    // destructive delete would otherwise follow.
    const { svc, secretRows } = await boot({ withDelete: false, forwardContext: false });
    await svc.set('sms', 'twilio_auth_token', 'alpha');
    await svc.set('sms', 'twilio_auth_token', 'beta');
    expect(secretRows()).toHaveLength(2);
  });
});
