// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8103 — the **report-only** half: which `sys_secret` rows are orphaned, and
 * why the answer is narrower than the card assumed.
 *
 * ## What this file measures, and why it runs against the real engine
 *
 * The card asks for #8063's three reachability facts to be **re-measured
 * rather than cited**, because a sweep over existing rows has a far wider
 * blast radius than the single point-delete those facts were argued for. A
 * hand-written fake mirroring the shapes we expect would only prove the fake
 * matches the fix, so the parts that can be driven end-to-end are driven
 * through a real `ObjectQL` over the real `SysSetting` / `SysSecret` schemas —
 * the same pieces the running server bolts together, with
 * `@objectstack/objectql` aliased to SOURCE by `vitest.config.ts`.
 *
 * The three facts, as measured here:
 *
 *  1. **Handle ids are minted per `encrypt()` call** — GREEN (case 1).
 *  2. **`sys_setting.value_enc` is the only column holding a handle** — ❌
 *     **RED / FALSIFIED** (cases 2–3). The engine's own `secret`-field channel
 *     writes `sys_secret` rows and stores `secret:<id>` on an arbitrary
 *     business row; the datasource binder does the same at
 *     `external.credentialsRef`. Case 3 is the safety pin that follows: a row
 *     this package cannot attribute is `unattributable`, never `orphaned`.
 *  3. **Audit records digests, not handles** — GREEN (case 4).
 *
 * Case 5 reproduces the **orphan-generating mechanism itself** (the filer's
 * 7 → 8 → 9 anecdote) rather than taking the count on trust, then classifies
 * the genuine table state it produced. Cases 6–8 pin the two directional
 * guards the card names, over a fixture carrying **all four classes**
 * (orphaned, in-force, legacy-inline, re-wrapped) — a fixture missing any of
 * them would make the pins vacuous.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import type { CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import type { SettingsEngine, SettingsSecretStore } from './settings-service.types.js';
import {
  classifySysSecretRows,
  collectEncryptedSpecifierRefs,
  isSecretHandle,
  SECRET_HANDLE_PREFIX,
  type SecretRowSnapshot,
  type SettingRowSnapshot,
} from './sys-secret-orphan-report.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_PACKAGE = 'com.objectstack.test.sys-secret-orphan-report';

const smsManifest: SettingsManifest = {
  namespace: 'sms',
  version: 1,
  label: 'SMS',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    { type: 'text', key: 'twilio_account_sid', label: 'Account SID', required: false },
    {
      type: 'password',
      key: 'twilio_auth_token',
      label: 'Auth token',
      required: false,
      encrypted: true,
    },
  ],
};

type Store = Map<string, Map<string, Record<string, unknown>>>;

/** A driver over plain Maps — enough of `IDataDriver` for these paths. */
function makeMemoryDriver() {
  const store: Store = new Map();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) {
      s = new Map();
      store.set(object, s);
    }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) return true;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      return (row[k] ?? null) === (expected ?? null);
    });
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {} as any,
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
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
    async delete(object: string, id: string) {
      return rowsOf(object).delete(id);
    },
    async count(object: string, ast: any) {
      return (await this.find(object, ast)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() {
      return [];
    },
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
    async syncSchema() {},
    async dropTable() {},
    async beginTransaction() {
      return { commit: async () => {}, rollback: async () => {} };
    },
    async commit() {},
    async rollback() {},
  };
  return { driver, rowsOf };
}

/**
 * Reproduces the PRE-#8030 adapter: identical to `wrapEngineAsSettingsEngine`
 * except that it DROPS `context` on the way to the engine.
 *
 * That single omission is the whole defect — `sys_setting.value_enc` is
 * declared `readonly: true` and the engine strips author-declared read-only
 * columns from a NON-system caller's UPDATE (`stripReadonlyFields`, gated on
 * `context.isSystem`), while the INSERT path is exempt (#3413). It is also
 * exactly the breakage `SettingsEngine`'s doc comment warns an adapter author
 * about ("⛔ An adapter over `IDataEngine` MUST forward this"), so reproducing
 * the orphan mechanism and pinning that warning are the same measurement.
 */
function wrapEngineDroppingContext(engine: any): SettingsEngine {
  const real = wrapEngineAsSettingsEngine(engine);
  return {
    find: real.find.bind(real),
    insert: real.insert.bind(real),
    async update(objectName, opts) {
      const { context: _dropped, ...withoutContext } = opts as any;
      return real.update(objectName, withoutContext);
    },
  };
}

/**
 * The four pieces the running server bolts together.
 *
 * `withDelete: false` drops the store's `delete`, which makes `reapRotatedSecret`
 * no-op (`SettingsSecretStore.delete` is OPTIONAL precisely so stores that
 * predate #8063 keep working). Faithfully reproducing the pre-#8030 era needs
 * BOTH that and `forwardContext: false`, because the context fix and the reaper
 * landed together in PR #8063 — an instance that dropped `context` while a
 * reaper was live never existed in the field.
 */
async function boot(opts: { forwardContext?: boolean; withDelete?: boolean } = {}) {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysSecret]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }

  const eng: any = engine;
  const secretStore: SettingsSecretStore = {
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
    ...(opts.withDelete === false
      ? {}
      : {
          async delete(id: string) {
            await eng.delete('sys_secret', {
              where: { id },
              bypassTenantAudit: true,
              context: { isSystem: true },
            });
          },
        }),
  };

  const auditEntries: Array<Record<string, unknown>> = [];
  const svc = new SettingsService({
    env: {},
    engine:
      opts.forwardContext === false
        ? wrapEngineDroppingContext(engine)
        : wrapEngineAsSettingsEngine(engine as any),
    cryptoProvider: new LocalCryptoProvider(),
    secretStore,
    auditWriter: {
      write(entry) {
        auditEntries.push({ ...entry } as Record<string, unknown>);
      },
    },
  });
  svc.registerManifest(smsManifest);

  /** Snapshot the real tables in the shape the report consumes. */
  const snapshot = () => {
    const secrets: SecretRowSnapshot[] = [...rowsOf('sys_secret').values()].map((r: any) => ({
      id: r.id,
      namespace: r.namespace,
      key: r.key,
      version: r.version ?? null,
      kms_key_id: r.kms_key_id ?? null,
      created_at: r.created_at ?? null,
      rotated_at: r.rotated_at ?? null,
    }));
    const settingRows: SettingRowSnapshot[] = [...rowsOf('sys_setting').values()].map((r: any) => ({
      namespace: r.namespace,
      key: r.key,
      scope: r.scope ?? null,
      user_id: r.user_id ?? null,
      value_enc: r.value_enc ?? null,
      encrypted: r.encrypted ?? null,
    }));
    return { secrets, settingRows };
  };

  return { engine, svc, rowsOf, snapshot, auditEntries };
}

const attributableTo = collectEncryptedSpecifierRefs([smsManifest]);

// ---------------------------------------------------------------------------
// Reachability fact 1 — handle ids are minted per encrypt() call
// ---------------------------------------------------------------------------

describe('#8103 reachability fact 1 — handle ids are minted per encrypt() call', () => {
  it('mints a fresh sec_ id per encrypt, and rotateKey keeps the id STABLE', async () => {
    const provider = new LocalCryptoProvider();
    const ctx = { namespace: 'sms', key: 'twilio_auth_token' };

    const a = await provider.encrypt('token-a', ctx);
    const b = await provider.encrypt('token-a', ctx); // same plaintext, same ctx

    // Per-CALL, not per-(namespace,key) and not per-plaintext: encrypting the
    // identical value twice yields two distinct handles naming two ciphertexts.
    expect(a.id).not.toBe(b.id);
    expect(isSecretHandle(a.id)).toBe(true);
    expect(isSecretHandle(b.id)).toBe(true);

    // The prefix constant is pinned against the REAL minter rather than against
    // a copy of the literal in `SettingsService`.
    expect(a.id.startsWith(SECRET_HANDLE_PREFIX)).toBe(true);

    // rotateKey re-wraps IN PLACE — same id, bumped version. This is why a
    // re-wrapped row is still the referenced one and must never read as retired.
    const rewrapped = await provider.rotateKey(a, ctx);
    expect(rewrapped.id).toBe(a.id);
    expect(rewrapped.version).toBe(a.version + 1);
    expect(await provider.decrypt(rewrapped, ctx)).toBe('token-a');
  });
});

// ---------------------------------------------------------------------------
// Reachability fact 2 — FALSIFIED
// ---------------------------------------------------------------------------

describe('#8103 reachability fact 2 — `sys_setting.value_enc` is NOT the only holder', () => {
  /**
   * The engine's own `secret`-field channel is a second producer of `sys_secret`
   * rows, and it stores its handle as `secret:<id>` on an arbitrary business
   * row. Nothing about it is visible from `sys_setting`.
   *
   * (The third producer, the datasource credential binder, stores
   * `sys_secret:<id>` at `external.credentialsRef` — same conclusion, and this
   * package does not depend on `service-datasource`, so it is measured by
   * source rather than driven here. `sys_secret`'s own schema names all three.)
   */
  it('the engine secret-field channel writes sys_secret rows no sys_setting row references', async () => {
    const engine = new ObjectQL();
    const { driver, rowsOf } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [SysSetting, SysSecret]) {
      engine.registry.registerObject(o as any, OWNER_PACKAGE);
    }
    // A perfectly ordinary business object carrying a `secret` field — the kind
    // a tenant can author. This is the set of holders that is not statically
    // enumerable.
    engine.registry.registerObject(
      {
        name: 'ext_vendor',
        label: 'Vendor',
        fields: {
          id: { name: 'id', label: 'ID', type: 'text' },
          name: { name: 'name', label: 'Name', type: 'text' },
          api_key: { name: 'api_key', label: 'API key', type: 'secret' },
        },
      } as any,
      OWNER_PACKAGE,
    );

    const provider = new LocalCryptoProvider();
    (engine as any).setCryptoProvider(provider as ICryptoProvider);

    const eng: any = engine;
    await eng.insert('ext_vendor', { name: 'acme', api_key: 'vendor-live-key' });

    const secretRows = [...rowsOf('sys_secret').values()];
    const settingRows = [...rowsOf('sys_setting').values()];

    // A real ciphertext row exists...
    expect(secretRows).toHaveLength(1);
    // ...produced under (object name, field name), not (settings ns, specifier).
    expect(secretRows[0]!.namespace).toBe('ext_vendor');
    expect(secretRows[0]!.key).toBe('api_key');
    // ...and NOTHING in sys_setting references it. Fact 2, as stated, is false.
    expect(settingRows).toHaveLength(0);

    // The handle lives on the business row, behind a different ref spelling.
    const vendor = (await eng.find('ext_vendor', {}))[0] as any;
    const storedRef = [...rowsOf('ext_vendor').values()][0]!.api_key as string;
    expect(storedRef.startsWith('secret:')).toBe(true);
    expect(storedRef.endsWith(secretRows[0]!.id as string)).toBe(true);
    expect(vendor).toBeDefined();
  });

  it('SAFETY PIN: a row the settings report cannot attribute is `unattributable`, never `orphaned`', () => {
    // Exactly the state the previous case produced: a live foreign-producer row,
    // referenced by nothing in `sys_setting`.
    const report = classifySysSecretRows({
      secrets: [{ id: 'sec_vendorlive', namespace: 'ext_vendor', key: 'api_key', version: 1 }],
      settingRows: [],
      attributableTo,
    });

    expect(report.counts.orphaned).toBe(0);
    expect(report.counts.unattributable).toBe(1);
    expect(report.rows[0]!.verdict).toBe('unattributable');
    // ⛔ This is the assertion that stands between a sweep and a live datasource
    // credential / business-row secret. Do not relax it.
    expect(report.rows[0]!.verdict).not.toBe('orphaned');
    expect(report.caveats.join(' ')).toContain('three producers');
  });
});

// ---------------------------------------------------------------------------
// Reachability fact 3 — audit records digests, not handles
// ---------------------------------------------------------------------------

describe('#8103 reachability fact 3 — the audit trail records digests, not handles', () => {
  it('no audit entry carries a sec_ handle, so audit survives a deletion (and cannot reconstruct one)', async () => {
    const { svc, auditEntries, snapshot } = await boot();
    await svc.set('sms', 'twilio_auth_token', 'tok-1');
    await svc.set('sms', 'twilio_auth_token', 'tok-2');

    expect(auditEntries.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(auditEntries);
    expect(serialised).not.toContain(SECRET_HANDLE_PREFIX);
    expect(serialised).not.toContain('tok-1');
    expect(serialised).not.toContain('tok-2');

    // What IS recorded is a content digest.
    const encryptedEntry = auditEntries.find((e) => e.encrypted === true)!;
    expect(String(encryptedEntry.newHash)).toMatch(/^sha256:[0-9a-f]{64}$/);

    // The other edge of the same fact: because no handle is ever recorded, the
    // audit trail cannot tell an operator which handles once existed — a row
    // deleted in error is untraceable from here.
    const { secrets } = snapshot();
    for (const s of secrets) expect(serialised).not.toContain(s.id);
  });
});

// ---------------------------------------------------------------------------
// The orphan-generating mechanism, reproduced rather than cited
// ---------------------------------------------------------------------------

describe('#8103 the pre-#8030 orphan mechanism, reproduced on this checkout', () => {
  it('three writes on a faithful pre-fix instance grow sys_secret 1→2→3 with value_enc pinned', async () => {
    const { svc, rowsOf } = await boot({ forwardContext: false, withDelete: false });

    await svc.set('sms', 'twilio_auth_token', 'tok-1');
    const afterFirst = [...rowsOf('sys_secret').values()].length;
    const pinnedHandle = [...rowsOf('sys_setting').values()][0]!.value_enc as string;

    await svc.set('sms', 'twilio_auth_token', 'tok-2');
    const afterSecond = [...rowsOf('sys_secret').values()].length;

    await svc.set('sms', 'twilio_auth_token', 'tok-3');
    const afterThird = [...rowsOf('sys_secret').values()].length;

    // The filer's 7 → 8 → 9, reproduced from a clean table: one new ciphertext
    // row per write, none of them ever referenced.
    expect([afterFirst, afterSecond, afterThird]).toEqual([1, 2, 3]);

    // And the handle never moved — the FIRST value is the one still in force.
    const settingRows = [...rowsOf('sys_setting').values()];
    expect(settingRows).toHaveLength(1);
    expect(settingRows[0]!.value_enc).toBe(pinnedHandle);
  });

  it('classifies the state that mechanism produced: 1 in-force + 2 orphaned', async () => {
    const { svc, snapshot } = await boot({ forwardContext: false, withDelete: false });
    await svc.set('sms', 'twilio_auth_token', 'tok-1');
    await svc.set('sms', 'twilio_auth_token', 'tok-2');
    await svc.set('sms', 'twilio_auth_token', 'tok-3');

    const { secrets, settingRows } = snapshot();
    const report = classifySysSecretRows({ secrets, settingRows, attributableTo });

    expect(report.counts.total).toBe(3);
    expect(report.counts.inForce).toBe(1);
    expect(report.counts.orphaned).toBe(2);
    expect(report.counts.unattributable).toBe(0);

    // The in-force row is the one the live `value_enc` names.
    const inForce = report.rows.find((r) => r.verdict === 'in_force')!;
    expect(settingRows[0]!.value_enc).toBe(inForce.id);

    // ⚠️ The card's security framing is INVERTED for this population, and the
    // direction matters to whoever picks the sweep's vehicle. The card reads
    // the orphans as "a decryptable copy of a credential an administrator
    // believed they had retired". Measured, they are the opposite: the value
    // still IN FORCE is the oldest one (`tok-1`) — the credential the admin
    // believed replaced — while the ORPHANS hold `tok-2`/`tok-3`, the values
    // the admin intended to set and which never took effect.
    //
    // So deleting the orphans does NOT retire the exposed credential; the
    // exposed one is referenced and a sweep will not touch it. It is also why
    // the orphans are not merely stale: if the admin rotated the credential at
    // the provider too, `tok-3` may be CURRENTLY VALID there.
    expect((await svc.get<string>('sms', 'twilio_auth_token')).value).toBe('tok-1');

    // Report mode names ids, never cipher material or plaintext.
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain('tok-1');
    expect(serialised).not.toContain('ciphertext');
  });

  it('with the context forwarded (post-#8030), the same three writes leave no orphan at all', async () => {
    const { svc, snapshot } = await boot();
    await svc.set('sms', 'twilio_auth_token', 'tok-1');
    await svc.set('sms', 'twilio_auth_token', 'tok-2');
    await svc.set('sms', 'twilio_auth_token', 'tok-3');

    const { secrets, settingRows } = snapshot();
    const report = classifySysSecretRows({ secrets, settingRows, attributableTo });

    // The forward-only reaper holds the population flat: this card is
    // remediation of a FROZEN set, not containment of a growing one.
    expect(report.counts.total).toBe(1);
    expect(report.counts.inForce).toBe(1);
    expect(report.counts.orphaned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// All four classes in one fixture + the directional guards
// ---------------------------------------------------------------------------

describe('#8103 classification over a fixture carrying ALL FOUR classes', () => {
  /**
   * Deliberately one fixture, not four: the card's vacuity trap is a classifier
   * test that is trivially green because the fixture contains no legacy-inline
   * and no re-wrapped row. All four are present here.
   */
  const secrets: SecretRowSnapshot[] = [
    // (a) in-force, plain
    { id: 'sec_inforce', namespace: 'sms', key: 'twilio_auth_token', version: 1 },
    // (b) orphaned — attributable, referenced by nothing
    { id: 'sec_orphan', namespace: 'sms', key: 'twilio_auth_token', version: 1 },
    // (c) re-wrapped IN PLACE and still referenced — version bumped, id stable
    {
      id: 'sec_rewrapped',
      namespace: 'mail',
      key: 'smtp_password',
      version: 3,
      kms_key_id: 'local:v3',
      rotated_at: '2026-07-01T00:00:00.000Z',
    },
    // (d) foreign producer — the engine secret-field channel
    { id: 'sec_vendor', namespace: 'ext_vendor', key: 'api_key', version: 1 },
  ];

  const settingRows: SettingRowSnapshot[] = [
    { namespace: 'sms', key: 'twilio_auth_token', value_enc: 'sec_inforce', encrypted: true },
    { namespace: 'mail', key: 'smtp_password', value_enc: 'sec_rewrapped', encrypted: true },
    // (e) LEGACY INLINE — the ciphertext itself sits in `value_enc`, no handle.
    { namespace: 'mail', key: 'api_key', value_enc: 'b64:c2VjcmV0LXZhbHVl', encrypted: true },
  ];

  const refs = [
    ...attributableTo,
    { namespace: 'mail', key: 'smtp_password' },
    { namespace: 'mail', key: 'api_key' },
  ];

  const report = classifySysSecretRows({ secrets, settingRows, attributableTo: refs });
  const byId = new Map(report.rows.map((r) => [r.id, r]));

  it('separates in-force / orphaned / unattributable', () => {
    expect(report.counts).toEqual({ total: 4, inForce: 2, orphaned: 1, unattributable: 1 });
    expect(byId.get('sec_inforce')!.verdict).toBe('in_force');
    expect(byId.get('sec_orphan')!.verdict).toBe('orphaned');
    expect(byId.get('sec_vendor')!.verdict).toBe('unattributable');
  });

  it('GUARD: a re-wrapped row is IN FORCE, not retired — version/rotated_at never decide a verdict', () => {
    const rewrapped = byId.get('sec_rewrapped')!;
    // The trap this pins: `version > 1` / `rotated_at != null` reads like "this
    // was rotated, so it is the old one". `rotateKey` keeps the handle stable,
    // so that row is the value IN FORCE — collecting it deletes a live secret.
    expect(rewrapped.verdict).toBe('in_force');
    expect(rewrapped.rewrapped).toBe(true);
    expect(rewrapped.reason).toContain('not a retirement');

    // And the evidence is inert: stripping it changes no verdict.
    const withoutEvidence = classifySysSecretRows({
      secrets: secrets.map((s) => ({ ...s, version: 1, rotated_at: null, kms_key_id: null })),
      settingRows,
      attributableTo: refs,
    });
    expect(withoutEvidence.counts).toEqual(report.counts);
  });

  it('GUARD: a legacy inline value contributes no handle, and flags its (namespace,key) siblings', () => {
    // #8063 guards its DELETE with a `sec_` prefix check; the guard needed here
    // is the other direction — an inline ciphertext must not enter the
    // referenced set, and must not make a sibling row look quietly collectable.
    expect(report.legacyInlineRows).toEqual([
      { namespace: 'mail', key: 'api_key', scope: null, user_id: null },
    ]);
    expect(isSecretHandle('b64:c2VjcmV0LXZhbHVl')).toBe(false);

    const withSibling = classifySysSecretRows({
      secrets: [...secrets, { id: 'sec_mailapikey', namespace: 'mail', key: 'api_key', version: 1 }],
      settingRows,
      attributableTo: refs,
    });
    const sibling = withSibling.rows.find((r) => r.id === 'sec_mailapikey')!;
    expect(sibling.verdict).toBe('orphaned');
    expect(sibling.legacyInlineSibling).toBe(true);
    expect(sibling.reason).toContain('LEGACY INLINE');
    expect(withSibling.caveats.join(' ')).toContain('inline ciphertext');
  });

  it('reports its own blind spots rather than a bare count', () => {
    expect(report.caveats.length).toBeGreaterThanOrEqual(3);
    expect(report.caveats.join(' ')).toContain('not statically enumerable');
    expect(report.caveats.join(' ')).toContain('HEURISTIC');
  });

  it('an empty attribution set yields zero orphans — the safe direction', () => {
    const none = classifySysSecretRows({ secrets, settingRows, attributableTo: [] });
    expect(none.counts.orphaned).toBe(0);
    expect(none.counts.unattributable).toBe(2); // the two unreferenced rows
    expect(none.caveats.join(' ')).toContain('No encrypted specifiers were supplied');
  });
});

describe('#8103 collectEncryptedSpecifierRefs', () => {
  it('collects only `encrypted: true` specifiers', () => {
    expect(collectEncryptedSpecifierRefs([smsManifest])).toEqual([
      { namespace: 'sms', key: 'twilio_auth_token' },
    ]);
  });

  it('tolerates an empty / specifier-less manifest set', () => {
    expect(collectEncryptedSpecifierRefs([])).toEqual([]);
    expect(
      collectEncryptedSpecifierRefs([{ namespace: 'x', version: 1, label: 'X' } as SettingsManifest]),
    ).toEqual([]);
  });
});

// Keep the unused-handle type import honest for `typecheck`.
export type _HandleShape = CryptoHandle;
