// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver, classifyIndexKeyPart, parseIndexDdl, legacyUniqueReplacements } from '../src/index.js';

/**
 * #8555 — `sys_setting`, the SIXTH instance of the #8323 class, and the first
 * one whose direction had to be MEASURED rather than inherited.
 *
 * ## Why this object got its own card instead of joining #8554's five
 *
 * A DECLARED index's bare `unique: true` is the positional spelling of
 * `'global'` — the listed columns verbatim — so
 * `(namespace, key, scope, user_id)` materialized as an installation-wide key
 * on a tenant-scoped object. But `sys_setting` had a real argument the other
 * five did not: it carries a `scope` column, and IF `scope` encoded tenancy the
 * installation-wide key would be correct and the fix would be to spell
 * `'global'` explicitly. The card refused to guess and asked for the reading.
 *
 * The reading: `scope` is the cascade LAYER, not the tenant. `global | tenant |
 * user` is a priority ladder (`scopeRank`), the organization is carried by
 * `organization_id` and nothing else (`loadRows`: "per-tenant isolation for
 * `tenant`-scope rows is still enforced by the engine"), and the `lifecycle`
 * manifest is built on per-organization `scope: 'tenant'` values — "regulated
 * tenants set years; dev sets days ... one deployment can carry both". So the
 * key is per-organization, and this object inherits the 2026-08-13 ruling.
 *
 * ## What the probe measured, live, before the fix
 *
 * Real driver, the REAL shipped declaration, `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_setting_namespace_key_scope_user_id
 *   on sys_setting (namespace, key, scope, user_id)
 *
 * scope='user'    org_jia POST (mail, smtp_host, user, usr_1) → 201
 *                 org_yi  POST the SAME                       → 409 UNIQUE_VIOLATION
 *                 org_yi  POST an unused key                  → 201   ← the ORACLE control
 *                 org_yi  GET  the colliding key              → 0 rows
 * scope='tenant'  org_jia 201 / org_yi the SAME → 201
 * scope='global'  platform 201 / platform the SAME → 201
 * ```
 *
 * ⚠️ Read the two 201s carefully — they are the thing this card did NOT expect
 * and the reason the probe was worth running. The class symptom reproduces on
 * the `user` limb exactly as predicted, but on the `tenant` and `global` limbs
 * the installation-wide index enforces **nothing at all**: `user_id` is NULL on
 * every such row and SQL UNIQUE is NULL-distinct, so even a SAME-organization
 * duplicate is accepted. Section 4 pins that as a live fact. It is a second,
 * independent defect, it is filed separately, and this respelling does not fix
 * it — stated here so the suite cannot be read as claiming otherwise.
 *
 * ## Why this suite is at the DRIVER level
 *
 * The driver is the only layer that materializes a unique constraint and the
 * only layer that can insert the violating row. `rest-server.ts` maps any error
 * satisfying `isUniqueViolationError` to `409 UNIQUE_VIOLATION` and a
 * successful create to `201`, so each case asserts the ENVELOPE the API would
 * put on the wire — never a bare `.toThrow()`, which a driver throwing a plain
 * `Error` would satisfy while REST answered 500.
 *
 * ## The half a fresh-database suite cannot see
 *
 * Respelling changes the index's generated NAME, and `initObjects` is
 * additive — it creates the new composite at boot and never drops the old one.
 * A deployed installation that takes this release without running the plan
 * keeps the defect. Section 3 is therefore the load-bearing part of this file:
 * it builds installations that ALREADY HAVE the old index and real rows, then
 * migrates them.
 */

/** The wire shape a duplicate insert must produce, per `rest-server.ts`. */
const CONFLICT_ENVELOPE = { status: 409, code: 'UNIQUE_VIOLATION' } as const;

const TABLE = 'sys_setting';
const KEY_COLUMNS = ['namespace', 'key', 'scope', 'user_id'] as const;
const LEGACY_NAME = 'uniq_sys_setting_namespace_key_scope_user_id';
const REPLACEMENT_NAME = 'uniq_sys_setting_organization_id_namespace_key_scope_user_id';

const s = { type: 'string' };
const b = { type: 'boolean' };

/** Physical columns the constraint and the rows need. */
const FIELDS: Record<string, { type: string }> = {
  id: s,
  organization_id: s,
  namespace: s,
  key: s,
  scope: s,
  user_id: s,
  value: s,
  encrypted: b,
  locked: b,
};

/**
 * ⚠️ Hand-copied from the shipped declaration, keeping the package boundary
 * (`driver-sql` must not depend on `platform-objects` — the shape #8461, #8556
 * and #8554 used). Guarded in ONE direction only:
 * `platform-objects/src/system/sys-setting.organization-unique.test.ts` asserts
 * the real `SysSetting.indexes` against its own inline literal, so a change to
 * the SHIPPED declaration that is not mirrored here goes red over there. The
 * reverse is unguarded. Change these only together with the declaration.
 *
 * The `unique: false` on the non-unique entries is not decoration:
 * `ObjectSchema.create` normalizes an authored `{ fields: [...] }` into that
 * shape, so this is what a driver is actually handed at registration.
 */
const PRE_INDEXES: Array<Record<string, unknown>> = [
  { fields: ['namespace', 'key', 'scope', 'user_id'], unique: true }, // ← the defect
  { fields: ['namespace', 'scope'], unique: false },
  { fields: ['user_id', 'namespace'], unique: false },
];
const FIXED_INDEXES: Array<Record<string, unknown>> = [
  { fields: ['namespace', 'key', 'scope', 'user_id'], unique: 'organization' },
  { fields: ['namespace', 'scope'], unique: false },
  { fields: ['user_id', 'namespace'], unique: false },
];

async function createAsApi(
  driver: SqlDriver,
  record: Record<string, unknown>,
): Promise<{ status: number; code?: string; raw?: unknown }> {
  try {
    await driver.create(TABLE, record as any);
    return { status: 201 };
  } catch (error) {
    if (isUniqueViolationError(error)) return { status: 409, code: 'UNIQUE_VIOLATION', raw: error };
    return { status: 500, code: 'INTERNAL_ERROR', raw: error };
  }
}

describe('#8555 — sys_setting: the declared unique index becomes per-organization', () => {
  let driver: SqlDriver | undefined;
  let savedPosture: string | undefined;
  let savedMultiOrg: string | undefined;

  const makeDriver = () => {
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    (d as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    driver = d;
    return d;
  };

  const app = (which: 'pre' | 'fixed') => [
    { name: TABLE, fields: FIELDS, indexes: which === 'pre' ? PRE_INDEXES : FIXED_INDEXES },
  ];

  beforeEach(() => {
    savedPosture = process.env.OS_TENANCY_POSTURE;
    savedMultiOrg = process.env.OS_MULTI_ORG_ENABLED;
    // The posture the probe was run on. ADR-0120's invariant is that no index
    // shape reads the posture — section 5 pins that — so this is context for
    // the reader, not an input the assertions depend on.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_MULTI_ORG_ENABLED = 'true';
  });

  afterEach(async () => {
    await driver?.disconnect();
    driver = undefined;
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
    if (savedMultiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = savedMultiOrg;
  });

  /** Unique index name → canonical key parts, COALESCE literal elided. */
  async function uniqueKeyParts(): Promise<Record<string, string[]>> {
    const k = (driver as any).knex;
    const list: any = await k.raw(`PRAGMA index_list(${TABLE})`);
    const master: any = await k.raw(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
      [TABLE],
    );
    const ddlByName = new Map<string, string>();
    for (const r of Array.isArray(master) ? master : (master?.rows ?? [])) {
      if (typeof r?.sql === 'string' && r.sql) ddlByName.set(r.name, r.sql);
    }
    const out: Record<string, string[]> = {};
    for (const idx of list) {
      if (idx.origin === 'pk' || idx.unique !== 1) continue;
      const parsed = parseIndexDdl(ddlByName.get(idx.name) ?? '');
      if (parsed) {
        out[idx.name] = parsed.keyParts.map((p) => {
          const part = classifyIndexKeyPart(p);
          if (part.kind === 'column') return part.column;
          return part.column === null ? p : `COALESCE(${part.column})`;
        });
      } else {
        const info: any = await k.raw(`PRAGMA index_info("${idx.name}")`);
        out[idx.name] = info.map((c: any) => c.name);
      }
    }
    return out;
  }

  /**
   * One settings row.
   *
   * `user_id` defaults to a REAL id, not null: the `user` limb is the one where
   * the class defect is observable, and a null there would silently move every
   * assertion into the NULL-distinct hole documented in section 4.
   */
  const row = (
    id: string,
    org: string | undefined,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id,
    ...(org ? { organization_id: org } : {}),
    namespace: 'mail',
    key: 'smtp_host',
    scope: 'user',
    user_id: 'usr_1',
    value: '"smtp.example.test"',
    ...over,
  });

  /** The colliding key, and the controls, as the probe drove them. */
  const KEY = {};
  const CONTROL = { key: 'only_in_org_yi' }; // differs in a LEADING key column
  const TRAILING_CONTROL = { user_id: 'usr_2' }; // differs in the LAST key column only

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Materialized shape — both spellings, kept side by side
  // ─────────────────────────────────────────────────────────────────────────

  it('the fixed declaration keys on the NULL-safe organization part', async () => {
    const d = makeDriver();
    await d.initObjects(app('fixed') as any);

    expect(await uniqueKeyParts()).toEqual({
      [REPLACEMENT_NAME]: ['COALESCE(organization_id)', ...KEY_COLUMNS],
    });
  });

  it('the pre-fix declaration keyed on the bare business columns — installation-wide', async () => {
    // Kept permanently rather than measured once: this is the contrast that
    // makes every "AFTER" assertion below mean something.
    const d = makeDriver();
    await d.initObjects(app('pre') as any);

    expect(await uniqueKeyParts()).toEqual({ [LEGACY_NAME]: [...KEY_COLUMNS] });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. The card's reproduction — the live probe the ruling required
  // ─────────────────────────────────────────────────────────────────────────

  it('BEFORE: a key held by another organization is refused — 409 on a row you cannot read', async () => {
    const d = makeDriver();
    await d.initObjects(app('pre') as any);

    expect((await createAsApi(d, row('a', 'org_jia', KEY))).status).toBe(201);
    expect(await createAsApi(d, row('b', 'org_yi', KEY))).toMatchObject(CONFLICT_ENVELOPE);

    // The control that makes the refusal an ORACLE rather than a blanket
    // rejection: an unused value from the same caller is accepted, so the 409
    // is a per-value answer about another tenant's data.
    expect((await createAsApi(d, row('c', 'org_yi', CONTROL))).status).toBe(201);

    // …and the other half of the oracle: the caller's own read of the colliding
    // key returns nothing. It is refused by a row it cannot see.
    const visible = (await d.find(TABLE, {})).filter(
      (r: any) =>
        r.organization_id === 'org_yi' &&
        r.namespace === 'mail' &&
        r.key === 'smtp_host' &&
        r.scope === 'user',
    );
    expect(visible).toHaveLength(0);
  });

  it('AFTER: the same cross-organization create is accepted — 409 flips to 201', async () => {
    const d = makeDriver();
    await d.initObjects(app('fixed') as any);

    expect((await createAsApi(d, row('a', 'org_jia', KEY))).status).toBe(201);
    expect((await createAsApi(d, row('b', 'org_yi', KEY))).status).toBe(201);

    const held = (await d.find(TABLE, {})).filter(
      (r: any) => r.namespace === 'mail' && r.key === 'smtp_host' && r.scope === 'user',
    );
    expect(held.map((r: any) => r.organization_id).sort()).toEqual(['org_jia', 'org_yi']);
  });

  it('AFTER (anti-vacuity): a SAME-organization duplicate is still refused', async () => {
    // If this ever goes green-by-acceptance the constraint was REMOVED, not
    // scoped — strictly worse than the defect being fixed, and
    // indistinguishable from the fix by the 409-flips-to-201 assertion alone.
    const d = makeDriver();
    await d.initObjects(app('fixed') as any);

    expect((await createAsApi(d, row('a', 'org_jia', KEY))).status).toBe(201);
    expect(await createAsApi(d, row('b', 'org_jia', KEY))).toMatchObject(CONFLICT_ENVELOPE);
    expect(await d.count(TABLE, {})).toBe(1);
  });

  it('AFTER: rows with no organization stay unique among THEMSELVES (ADR-0120 D3)', async () => {
    // This is the arm that answers the card's "argument for keeping it global".
    // The `scope='global'` LAYER — the platform default every organization
    // resolves against at rung 2 — is preserved by the NULL-safe key part, not
    // by making the whole index installation-wide: platform rows carry no
    // organization, so they share the one `__global__` bucket and remain unique
    // within it, while an organization may still hold its own row of the same
    // key at its own layer.
    const d = makeDriver();
    await d.initObjects(app('fixed') as any);

    const platform = { scope: 'global', namespace: 'branding', key: 'logo_url' };
    expect((await createAsApi(d, row('seed1', undefined, platform))).status).toBe(201);
    expect(await createAsApi(d, row('seed2', undefined, platform))).toMatchObject(
      CONFLICT_ENVELOPE,
    );

    expect((await createAsApi(d, row('own1', 'org_jia', platform))).status).toBe(201);
  });

  it('the key is the whole COMPOSITE — varying only the trailing column was always accepted', async () => {
    // Guards the fixture's own claim about which columns the constraint spans.
    // Green BEFORE and AFTER by design: it describes behaviour this card does
    // not change, which is exactly what makes it a control. If the key were
    // silently narrowed to the leading columns this goes red.
    const d = makeDriver();
    await d.initObjects(app('pre') as any);

    expect((await createAsApi(d, row('a', 'org_jia', KEY))).status).toBe(201);
    expect((await createAsApi(d, row('b', 'org_yi', TRAILING_CONTROL))).status).toBe(201);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. The deployed-installation half — the #8323 trap
  // ─────────────────────────────────────────────────────────────────────────

  describe('migration on a database built before the respelling', () => {
    /**
     * An installation that ALREADY HAS the old global index and real rows —
     * i.e. every deployment in the field. A fresh-provision test cannot reach
     * any of the assertions in this block.
     *
     * ⚠️ `dup1`/`dup2` are not padding. A deployed `sys_setting` can ALREADY
     * carry duplicate `scope='tenant'` rows, because the pre-fix index is
     * NULL-distinct on `user_id` (section 4). Seeding them here is what proves
     * the migration stays applicable on a database the old constraint let rot —
     * the replacement index does not tighten the `user_id` column, so it can
     * still be created. A fix that DID tighten it would fail to build the index
     * on exactly these rows, which is why that half is a separate card with a
     * duplicate pre-flight rather than a rider on this one.
     */
    const seedDeployed = async (d: SqlDriver) => {
      await d.initObjects(app('pre') as any);
      await d.create(TABLE, row('r1', 'org_jia', KEY) as any);
      await d.create(TABLE, row('r2', 'org_jia', CONTROL) as any);
      await d.create(TABLE, row('r3', undefined, { scope: 'global', key: 'platform_default' }) as any);
      await d.create(TABLE, {
        id: 'dup1', organization_id: 'org_jia', namespace: 'lifecycle',
        key: 'retention_overrides', scope: 'tenant', user_id: null, value: '"x"',
      } as any);
      await d.create(TABLE, {
        id: 'dup2', organization_id: 'org_jia', namespace: 'lifecycle',
        key: 'retention_overrides', scope: 'tenant', user_id: null, value: '"y"',
      } as any);
    };

    it('the seeded database really carries the pre-fix index, and the defect is live on it (harness guard)', async () => {
      // Without this the whole block could be exercising a fresh schema and
      // every assertion below would still pass. Named as a guard on purpose.
      const d = makeDriver();
      await seedDeployed(d);

      expect(await uniqueKeyParts()).toEqual({ [LEGACY_NAME]: [...KEY_COLUMNS] });
      expect(await d.count(TABLE, {})).toBe(5);
      expect(await createAsApi(d, row('x', 'org_yi', KEY))).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('is planned as ONE pure relaxation, categorised safe — not a destructive orphan drop', async () => {
      const d = makeDriver();
      await seedDeployed(d);
      // The new metadata arrives (a deploy), same database.
      await d.initObjects(app('fixed') as any);

      const drift = await d.detectManagedDrift();
      expect(drift.filter((e) => e.table === TABLE)).toHaveLength(1);
      const entry = drift.find((e) => e.table === TABLE && e.op.type === 'replace_unique_index');
      expect(entry, 'the respelling must be a replacement, not two unrelated findings').toBeDefined();
      expect(entry!.category).toBe('safe');
      expect(entry!.op).toMatchObject({
        dropIndexNames: [LEGACY_NAME],
        createIndexName: REPLACEMENT_NAME,
        createColumns: ['organization_id', ...KEY_COLUMNS],
        nullSafeColumns: ['organization_id'],
      });

      // ⛔ The old index must NOT ALSO surface as an orphan. An orphan drop is
      // `destructive`, so an operator applying only the safe half would keep the
      // global index — keep the defect — while the plan read as applied. That is
      // the exact failure #8323 measured.
      expect(
        drift.filter(
          (e) => e.op.type === 'drop_index' && (e.op as any).indexName === LEGACY_NAME,
        ),
      ).toHaveLength(0);
    });

    it('applies WITHOUT --allow-destructive, keeps every row, and converges', async () => {
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(app('fixed') as any);

      const drift = await d.detectManagedDrift();
      const { applied, skipped } = await d.applyMigrationEntries(drift, { allowDestructive: false });
      expect(applied.some((e) => e.op.type === 'replace_unique_index')).toBe(true);
      expect(skipped).toHaveLength(0);

      expect(await uniqueKeyParts()).toEqual({
        [REPLACEMENT_NAME]: ['COALESCE(organization_id)', ...KEY_COLUMNS],
      });
      // Every row survives — including the two pre-existing duplicates the old
      // index allowed. A migration that silently dropped them would be data loss
      // dressed as a fix.
      expect(await d.count(TABLE, {})).toBe(5);

      // Re-running finds nothing: the plan is not a drop/create cycle.
      expect(await d.detectManagedDrift()).toHaveLength(0);
    });

    it('after applying, BOTH halves hold on the MIGRATED database', async () => {
      // The assertion the card is actually about: the fix reaches a deployed
      // installation, not merely a freshly provisioned one.
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(app('fixed') as any);
      await d.applyMigrationEntries(await d.detectManagedDrift(), { allowDestructive: false });

      expect((await createAsApi(d, row('z1', 'org_yi', KEY))).status).toBe(201);

      // The anti-vacuity arm, on the SAME migrated index.
      expect(await createAsApi(d, row('z2', 'org_jia', KEY))).toMatchObject(CONFLICT_ENVELOPE);

      // …and the organization-less bucket survived the migration intact: the
      // seeded platform row still blocks a duplicate of ITSELF.
      expect(
        await createAsApi(d, row('z3', undefined, { scope: 'global', key: 'platform_default' })),
      ).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('boot creates the replacement ADDITIVELY, so the defect is STILL LIVE until the plan runs', async () => {
      // `initObjects` is additive-only: it materializes the newly-declared
      // composite at boot and never drops anything. So a deployed installation
      // that has taken the new code but not run the plan is still enumerable —
      // deploying the respelling is not, by itself, the fix. This is the
      // sentence an operator needs, stated as an assertion.
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(app('fixed') as any);

      expect(Object.keys(await uniqueKeyParts()).sort()).toEqual(
        [LEGACY_NAME, REPLACEMENT_NAME].sort(),
      );
      expect(await createAsApi(d, row('y', 'org_yi', KEY))).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('DROP happens only once the replacement is confirmed present', async () => {
      // The safety argument in the direction that can actually go wrong: if the
      // replacement is not there, the legacy index must be left alone rather
      // than dropped into a gap with no uniqueness at all.
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(app('fixed') as any);
      const drift = await d.detectManagedDrift();

      await (d as any).knex.raw(`DROP INDEX ${REPLACEMENT_NAME}`);
      (d as any).syncDeclaredIndexes = async () => undefined;

      const { applied, skipped } = await d.applyMigrationEntries(drift, { allowDestructive: false });
      const isReplace = (e: { table: string; op: { type: string } }) =>
        e.table === TABLE && e.op.type === 'replace_unique_index';
      expect(applied.some(isReplace)).toBe(false);
      expect(skipped.some(isReplace)).toBe(true);

      // The pre-migration constraint is intact: never left with neither index.
      expect(Object.keys(await uniqueKeyParts())).toEqual([LEGACY_NAME]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. The OTHER defect this card does not fix — pinned so it cannot be
  //    mistaken for fixed, and so the follow-up card has a live repro
  // ─────────────────────────────────────────────────────────────────────────

  describe('the NULL-distinct user_id hole (out of scope here — filed as #8629)', () => {
    /**
     * `user_id` is NULL on every `scope='tenant'` and `scope='global'` row —
     * `SettingsService` writes `scope === 'user' ? ctx.userId : null` — and SQL
     * UNIQUE treats NULLs as distinct. The declared row identity is therefore
     * void on exactly the two limbs that carry organization-level and
     * platform-level configuration, BEFORE and AFTER this card.
     *
     * The organization key part is NULL-safe (ADR-0120 D3); the author-declared
     * `user_id` column is not, and extending null-safety to arbitrary declared
     * columns is a contract decision plus a duplicate pre-flight for the
     * databases that have already accumulated duplicates. Hence a separate card:
     * #8629.
     *
     * These assertions are written to go RED when that card lands — a fix must
     * come here and rewrite them, rather than leaving a stale "known hole"
     * comment behind.
     */
    it('BEFORE: two organizations CAN both hold the same tenant-scope key — the constraint is void, not oracular', async () => {
      const d = makeDriver();
      await d.initObjects(app('pre') as any);

      const tenantRow = { scope: 'tenant', user_id: null, namespace: 'lifecycle', key: 'retention_overrides' };
      expect((await createAsApi(d, row('a', 'org_jia', tenantRow))).status).toBe(201);
      // 201, not 409: the card predicted a refusal here. The refusal never
      // happens because the index cannot see these rows as equal at all.
      expect((await createAsApi(d, row('b', 'org_yi', tenantRow))).status).toBe(201);
    });

    it('BEFORE and AFTER: a SAME-organization tenant-scope duplicate is accepted — declared row identity unenforced', async () => {
      for (const which of ['pre', 'fixed'] as const) {
        const d = makeDriver();
        await d.initObjects(app(which) as any);

        const tenantRow = { scope: 'tenant', user_id: null, namespace: 'lifecycle', key: 'retention_overrides' };
        expect((await createAsApi(d, row('a', 'org_jia', tenantRow))).status, which).toBe(201);
        expect((await createAsApi(d, row('b', 'org_jia', tenantRow))).status, which).toBe(201);
        expect(await d.count(TABLE, {}), which).toBe(2);

        await d.disconnect();
        driver = undefined;
      }
    });

    it('BEFORE and AFTER: the same hole on the platform (`scope=global`) layer', async () => {
      for (const which of ['pre', 'fixed'] as const) {
        const d = makeDriver();
        await d.initObjects(app(which) as any);

        const globalRow = { scope: 'global', user_id: null, key: 'platform_default' };
        expect((await createAsApi(d, row('a', undefined, globalRow))).status, which).toBe(201);
        expect((await createAsApi(d, row('b', undefined, globalRow))).status, which).toBe(201);

        await d.disconnect();
        driver = undefined;
      }
    });

    it('the hole is the NULL, not the layer — the same rows with a non-null user_id ARE constrained', async () => {
      // The control that identifies the mechanism. Without it, "tenant rows are
      // unconstrained" could be read as something about the `scope` value.
      const d = makeDriver();
      await d.initObjects(app('fixed') as any);

      const named = { scope: 'tenant', user_id: 'usr_1', namespace: 'lifecycle', key: 'retention_overrides' };
      expect((await createAsApi(d, row('a', 'org_jia', named))).status).toBe(201);
      expect(await createAsApi(d, row('b', 'org_jia', named))).toMatchObject(CONFLICT_ENVELOPE);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. The #8461 arm and its guards, exercised on THIS object
  // ─────────────────────────────────────────────────────────────────────────

  describe('the declared-index replacement arm', () => {
    const physicalColumns = () => new Set(Object.keys(FIELDS));

    it('proposes exactly one retirement, keyed on the listed columns', () => {
      const [entry, ...rest] = legacyUniqueReplacements({
        table: TABLE,
        fields: {},
        tenantField: 'organization_id',
        physicalColumns: physicalColumns(),
        declaredIndexes: FIXED_INDEXES,
      } as any);
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({
        // ⚠️ `legacyColumns` is the whole listed key, not the leading column.
        // `column` is the LEADING one and is reporting only — this four-column
        // key is what makes the distinction observable.
        legacyColumns: [...KEY_COLUMNS],
        legacyNames: [LEGACY_NAME],
        replacement: {
          name: REPLACEMENT_NAME,
          columns: ['organization_id', ...KEY_COLUMNS],
          unique: true,
          nullSafeColumns: ['organization_id'],
        },
      });
    });

    it('claims nothing for an EXPLICITLY NAMED index — that transition is a recreate', () => {
      // #8461 guard 1. If this ever starts proposing a replacement it would ask
      // to drop the very index `recreate_index` is rebuilding.
      expect(
        legacyUniqueReplacements({
          table: TABLE,
          fields: {},
          tenantField: 'organization_id',
          physicalColumns: physicalColumns(),
          declaredIndexes: [{ name: 'uq_hand_named', fields: [...KEY_COLUMNS], unique: 'organization' }],
        } as any),
      ).toHaveLength(0);
    });

    it('claims nothing when the legacy name IS the replacement name (the S6 composite)', () => {
      // #8461 guard 2 — what protects sys_team / sys_business_unit / sys_member
      // and the S6 objects this card's own sweep re-triaged and left alone.
      expect(
        legacyUniqueReplacements({
          table: TABLE,
          fields: {},
          tenantField: 'organization_id',
          physicalColumns: physicalColumns(),
          declaredIndexes: [{ fields: ['organization_id', ...KEY_COLUMNS], unique: 'organization' }],
        } as any),
      ).toHaveLength(0);
    });

    it('claims nothing for the BARE spelling — an unrespelled declaration is untouched (#5082)', () => {
      expect(
        legacyUniqueReplacements({
          table: TABLE,
          fields: {},
          tenantField: 'organization_id',
          physicalColumns: physicalColumns(),
          declaredIndexes: [{ fields: [...KEY_COLUMNS], unique: true }],
        } as any),
      ).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. ADR-0120: no index shape reads the posture
  // ─────────────────────────────────────────────────────────────────────────

  describe('postureIndependence', () => {
    it('materializes the same key parts under single / group / isolated', async () => {
      for (const posture of ['single', 'group', 'isolated']) {
        process.env.OS_TENANCY_POSTURE = posture;
        const d = makeDriver();
        await d.initObjects(app('fixed') as any);
        expect(await uniqueKeyParts(), `posture=${posture}`).toEqual({
          [REPLACEMENT_NAME]: ['COALESCE(organization_id)', ...KEY_COLUMNS],
        });
        await d.disconnect();
        driver = undefined;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. The index-name length boundary
  // ─────────────────────────────────────────────────────────────────────────

  describe('the replacement index name', () => {
    /**
     * The replacement name is EXACTLY 60 characters — `INDEX_NAME_MAX`. It is
     * emitted verbatim; one more character in the table name or any key column
     * would push it over and `buildIndexName` would truncate it to a sha1-suffixed
     * form instead. Worth pinning because a name-based retirement is precisely
     * where that would go wrong: if the legacy and replacement names ever
     * collapsed to the same string, the `legacyName === replacement.name` guard
     * would read the respelling as "nothing was superseded" and emit NO
     * migration — a fresh database would look right and every deployed
     * installation would keep the global index forever.
     */
    it('sits exactly on the 60-character boundary and is emitted untruncated', () => {
      expect(REPLACEMENT_NAME.length).toBe(60);
      expect(REPLACEMENT_NAME).not.toMatch(/_[0-9a-f]{8}$/);
    });

    it('differs from the legacy name, so the S6 guard does not swallow the retirement', () => {
      expect(LEGACY_NAME.length).toBeLessThanOrEqual(60);
      expect(REPLACEMENT_NAME).not.toBe(LEGACY_NAME);
    });

    it('the pinned name is what actually materializes, and the migration converges on it', async () => {
      const d = makeDriver();
      await d.initObjects(app('pre') as any);
      await d.create(TABLE, row('r1', 'org_jia', KEY) as any);
      await d.initObjects(app('fixed') as any);
      await d.applyMigrationEntries(await d.detectManagedDrift(), { allowDestructive: false });

      expect(Object.keys(await uniqueKeyParts())).toEqual([REPLACEMENT_NAME]);
      expect(await d.detectManagedDrift()).toHaveLength(0);
    });
  });
});
