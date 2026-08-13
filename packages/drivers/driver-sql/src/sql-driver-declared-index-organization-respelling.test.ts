// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import {
  SqlDriver,
  classifyIndexKeyPart,
  parseIndexDdl,
  normalizeDeclaredIndex,
  uniqueIndexesFromFields,
  legacyUniqueReplacements,
} from '../src/index.js';

/**
 * #8323 — a tenant-scoped object's DECLARED unique index materialized GLOBALLY,
 * and the platform's own objects were declared that way.
 *
 * ## What was measured in the field
 *
 * On a deployment running `OS_TENANCY_POSTURE=isolated`, with one user who
 * belongs to two organizations:
 *
 * ```
 * as 乙: POST /data/sys_user_preference {user_id, key:"ui.recent"} → 409 UNIQUE_VIOLATION
 * as 甲: GET  /data/sys_user_preference?filter=["key","=","ui.recent"] → total 0
 * ```
 *
 * The row it collided with was invisible to the caller — so the refusal was an
 * existence oracle over another tenant's data, and (the live half) the console's
 * own "recent items" preference could never persist in a user's SECOND
 * organization. `data-objectstack`'s `userState.save()` swallows the failure by
 * design, so it failed silently, forever.
 *
 * ## Why the declaration was global
 *
 * Not a regression in #4986 — a DELIBERATE divergence between two spellings,
 * pinned in `spellings` below. Field-level `unique: true` has meant "per
 * organization" since #3696; a DECLARED index's `unique: true` is the positional
 * spelling of `'global'` and takes the listed columns VERBATIM. Only the
 * explicit `'organization'` prepends the NULL-safe organization key part.
 * `packages/lint/src/data-model-rules.ts` calls this "the #4986 trap" and warns
 * on it (`unique/unscoped-declared-index`); `sys_user_preference` and
 * `sys_capability` were two instances of it in the platform's own metadata.
 *
 * ## Why this suite is at the DRIVER level
 *
 * The same argument `adr0120-three-posture-conformance.test.ts` makes: the
 * driver is the only layer that materializes a unique constraint, and it is the
 * only layer that can insert the violating row. The REST status codes the issue
 * reports are a pure function of what happens here — `rest-server.ts` maps any
 * error satisfying `isUniqueViolationError` to `409 UNIQUE_VIOLATION` and a
 * successful create to `201`. So each case below asserts the ENVELOPE the API
 * would produce (`isUniqueViolationError` ⇒ 409 + `code: 'UNIQUE_VIOLATION'`),
 * not merely "it threw".
 *
 * ## Both directions are pinned, deliberately
 *
 * A fix that made the cross-organization insert succeed by REMOVING uniqueness
 * would be a far worse defect than the one being fixed, and it would look
 * identical from the 409-flips-to-201 side alone. Every scenario therefore
 * carries its anti-vacuity twin: the same-organization duplicate must still be
 * refused. `old` fixtures (the pre-#8323 spelling) are kept alongside `new` ones
 * so the contrast is a permanent assertion rather than a one-off measurement.
 */

/** The wire shape a duplicate insert must produce, per `rest-server.ts`. */
const CONFLICT_ENVELOPE = { status: 409, code: 'UNIQUE_VIOLATION' } as const;

/**
 * Drive a create the way the REST layer does and report the envelope it would
 * put on the wire — `{ status: 201 }` for an accepted row, or the
 * `409 UNIQUE_VIOLATION` body `rest-server.ts` derives from
 * `isUniqueViolationError`. Asserting on this rather than on `.toThrow()` is
 * what makes a green run mean the API contract holds: a driver that threw a
 * bare `Error` would satisfy `toThrow()` while REST answered `500`.
 */
async function createAsApi(
  driver: SqlDriver,
  object: string,
  record: Record<string, unknown>,
): Promise<{ status: number; code?: string; row?: any; raw?: unknown }> {
  try {
    const row = await driver.create(object, record as any);
    return { status: 201, row };
  } catch (error) {
    if (isUniqueViolationError(error)) return { status: 409, code: 'UNIQUE_VIOLATION', raw: error };
    return { status: 500, code: 'INTERNAL_ERROR', raw: error };
  }
}

describe('#8323 — declared unique indexes on the platform’s tenant-scoped objects', () => {
  let driver: SqlDriver | undefined;
  let savedPosture: string | undefined;
  let savedMultiOrg: string | undefined;

  const makeDriver = (opts: any = {}) => {
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });
    (d as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    driver = d;
    return d;
  };

  beforeEach(() => {
    savedPosture = process.env.OS_TENANCY_POSTURE;
    savedMultiOrg = process.env.OS_MULTI_ORG_ENABLED;
    // The posture the issue was measured on. ADR-0120's invariant is that no
    // index shape reads the posture, so this is context for the reader rather
    // than an input the assertions depend on — `postureIndependence` pins that.
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
  async function uniqueKeyParts(table: string): Promise<Record<string, string[]>> {
    const k = (driver as any).knex;
    const list: any = await k.raw(`PRAGMA index_list(${table})`);
    const master: any = await k.raw(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
      [table],
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

  // ─────────────────────────────────────────────────────────────────────────
  // 1. WHY the #4986 fix did not cover the table-level declaration
  // ─────────────────────────────────────────────────────────────────────────

  describe('the two `unique` spellings diverge by design (the #4986 answer)', () => {
    it('a DECLARED index’s bare `true` takes the listed columns verbatim — no tenant column', () => {
      const norm = normalizeDeclaredIndex(
        'sys_user_preference',
        { fields: ['user_id', 'key'], unique: true },
        'organization_id',
      );
      // This is the pre-#8323 declaration, and this is what it materialized:
      // a GLOBAL unique index. The tenant column is offered and not taken.
      expect(norm).toEqual({
        name: 'uniq_sys_user_preference_user_id_key',
        columns: ['user_id', 'key'],
        unique: true,
      });
      expect(norm!.nullSafeColumns).toBeUndefined();
    });

    it('`unique: "global"` is the same shape — bare `true` is its positional spelling', () => {
      const bare = normalizeDeclaredIndex('t', { fields: ['a', 'b'], unique: true }, 'organization_id');
      const explicit = normalizeDeclaredIndex('t', { fields: ['a', 'b'], unique: 'global' }, 'organization_id');
      expect(bare).toEqual(explicit);
    });

    it('only the explicit `"organization"` spelling prepends the NULL-safe organization key part', () => {
      const norm = normalizeDeclaredIndex(
        'sys_user_preference',
        { fields: ['user_id', 'key'], unique: 'organization' },
        'organization_id',
      );
      expect(norm).toEqual({
        name: 'uniq_sys_user_preference_organization_id_user_id_key',
        columns: ['organization_id', 'user_id', 'key'],
        unique: true,
        nullSafeColumns: ['organization_id'],
      });
    });

    it('FIELD-level bare `true` DOES scope per organization — the divergence itself', () => {
      // Same two characters, opposite meaning, one level up. An author who
      // reads the field-level rule and writes the table-level declaration gets
      // the global index silently: that is the whole content of #8323, and it
      // is why the fix is a respelling rather than a driver change.
      const [fieldLevel] = uniqueIndexesFromFields(
        'sys_user_preference',
        { key: { type: 'string', unique: true } },
        'organization_id',
      );
      expect(fieldLevel).toEqual({
        name: 'uniq_sys_user_preference_organization_id_key',
        columns: ['organization_id', 'key'],
        unique: true,
        nullSafeColumns: ['organization_id'],
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. The platform declarations, materialized
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * The two objects the ruling names, reduced to the columns and the declared
   * `indexes[]` entry that carry the constraint. The `indexes[]` entries are
   * byte-identical to the shipped declarations; `sys-user-preference.object.ts`
   * and `sys-capability.object.ts` carry pin tests asserting that, so the
   * fixture and the real metadata cannot drift apart silently.
   */
  const PRE_FIX_APP = [
    {
      name: 'sys_user_preference',
      fields: {
        id: { type: 'string' },
        organization_id: { type: 'string' },
        user_id: { type: 'string' },
        key: { type: 'string' },
      },
      indexes: [
        { fields: ['user_id', 'key'], unique: true }, // ← the defect
        { fields: ['user_id'], unique: false },
      ],
    },
    {
      name: 'sys_capability',
      fields: {
        id: { type: 'string' },
        organization_id: { type: 'string' },
        name: { type: 'string' },
      },
      indexes: [{ fields: ['name'], unique: true }], // ← the defect
    },
  ] as const;

  const FIXED_APP = [
    {
      name: 'sys_user_preference',
      fields: {
        id: { type: 'string' },
        organization_id: { type: 'string' },
        user_id: { type: 'string' },
        key: { type: 'string' },
      },
      indexes: [
        { fields: ['user_id', 'key'], unique: 'organization' },
        { fields: ['user_id'], unique: false },
      ],
    },
    {
      name: 'sys_capability',
      fields: {
        id: { type: 'string' },
        organization_id: { type: 'string' },
        name: { type: 'string' },
      },
      indexes: [{ fields: ['name'], unique: 'organization' }],
    },
  ] as const;

  describe('materialized shape', () => {
    it('the fixed declarations key on the NULL-safe organization part', async () => {
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(await uniqueKeyParts('sys_user_preference')).toEqual({
        uniq_sys_user_preference_organization_id_user_id_key: [
          'COALESCE(organization_id)',
          'user_id',
          'key',
        ],
      });
      expect(await uniqueKeyParts('sys_capability')).toEqual({
        uniq_sys_capability_organization_id_name: ['COALESCE(organization_id)', 'name'],
      });
    });

    it('the pre-fix declarations keyed on the bare business columns — installation-wide', async () => {
      const d = makeDriver();
      await d.initObjects(PRE_FIX_APP as any);

      expect(await uniqueKeyParts('sys_user_preference')).toEqual({
        uniq_sys_user_preference_user_id_key: ['user_id', 'key'],
      });
      expect(await uniqueKeyParts('sys_capability')).toEqual({
        uniq_sys_capability_name: ['name'],
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. The card's reproduction — both halves
  // ─────────────────────────────────────────────────────────────────────────

  describe('§1/§2 the cross-organization existence oracle', () => {
    it('BEFORE: a value held by another organization is refused — 409 on a row you cannot read', async () => {
      const d = makeDriver();
      await d.initObjects(PRE_FIX_APP as any);

      const first = await createAsApi(d, 'sys_capability', {
        id: 'c1',
        organization_id: 'org_jia',
        name: 'probe_cap_xtenant',
      });
      expect(first.status).toBe(201);

      const crossOrg = await createAsApi(d, 'sys_capability', {
        id: 'c2',
        organization_id: 'org_yi',
        name: 'probe_cap_xtenant',
      });
      expect(crossOrg).toMatchObject(CONFLICT_ENVELOPE);

      // …and the control from the issue: an unused name is accepted, so the
      // refusal above is a per-VALUE answer. That is what makes it an oracle.
      const control = await createAsApi(d, 'sys_capability', {
        id: 'c3',
        organization_id: 'org_yi',
        name: 'probe_cap_only_in_b',
      });
      expect(control.status).toBe(201);
    });

    it('AFTER: the same cross-organization create is accepted — 409 flips to 201', async () => {
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(
        (await createAsApi(d, 'sys_capability', { id: 'c1', organization_id: 'org_jia', name: 'probe_cap_xtenant' }))
          .status,
      ).toBe(201);
      expect(
        (await createAsApi(d, 'sys_capability', { id: 'c2', organization_id: 'org_yi', name: 'probe_cap_xtenant' }))
          .status,
      ).toBe(201);

      // Both rows exist, each stamped to its own organization.
      const held = (await d.find('sys_capability', {})).filter((r: any) => r.name === 'probe_cap_xtenant');
      expect(held.map((r: any) => r.organization_id).sort()).toEqual(['org_jia', 'org_yi']);
    });

    it('AFTER (anti-vacuity): a SAME-organization duplicate is still refused', async () => {
      // If this ever goes green-by-acceptance the constraint was REMOVED, not
      // scoped — a strictly worse defect than the one #8323 reports.
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(
        (await createAsApi(d, 'sys_capability', { id: 'c1', organization_id: 'org_jia', name: 'manage_users' }))
          .status,
      ).toBe(201);
      const sameOrg = await createAsApi(d, 'sys_capability', {
        id: 'c2',
        organization_id: 'org_jia',
        name: 'manage_users',
      });
      expect(sameOrg).toMatchObject(CONFLICT_ENVELOPE);
      expect(await d.count('sys_capability', {})).toBe(1);
    });

    it('AFTER: platform-seeded rows carry no organization and stay unique among THEMSELVES (D3)', async () => {
      // The NULL-safe key part is what makes this hold: a bare
      // `(organization_id, name)` composite would be NULL-distinct under SQL,
      // so every platform-seeded capability could be duplicated at will.
      // `bootstrapSystemCapabilities` upserts by name and depends on it.
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect((await createAsApi(d, 'sys_capability', { id: 'p1', name: 'manage_metadata' })).status).toBe(201);
      const duplicateSeed = await createAsApi(d, 'sys_capability', { id: 'p2', name: 'manage_metadata' });
      expect(duplicateSeed).toMatchObject(CONFLICT_ENVELOPE);

      // An organization may still define its own row of the same name — that
      // is the ADR-0066 "admins EXTEND the registry" case, and the reason the
      // platform bucket and the organization buckets are separate.
      expect(
        (await createAsApi(d, 'sys_capability', { id: 'o1', organization_id: 'org_jia', name: 'manage_metadata' }))
          .status,
      ).toBe(201);
    });
  });

  describe('§3 end to end — a two-organization user’s preferences persist in BOTH', () => {
    it('BEFORE: the second organization can never hold a key the first already used', async () => {
      const d = makeDriver();
      await d.initObjects(PRE_FIX_APP as any);

      expect(
        (await createAsApi(d, 'sys_user_preference', {
          id: 'p1',
          organization_id: 'org_jia',
          user_id: 'zhangsan',
          key: 'ui.recent',
        })).status,
      ).toBe(201);

      const secondOrg = await createAsApi(d, 'sys_user_preference', {
        id: 'p2',
        organization_id: 'org_yi',
        user_id: 'zhangsan',
        key: 'ui.recent',
      });
      // The measured symptom: refused, invisibly — `userState.save()` swallows
      // it, so the preference simply never persisted in the second workspace.
      expect(secondOrg).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('AFTER: the same user holds an independent `ui.recent` in each organization', async () => {
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      const jia = await createAsApi(d, 'sys_user_preference', {
        id: 'p1',
        organization_id: 'org_jia',
        user_id: 'zhangsan',
        key: 'ui.recent',
      });
      const yi = await createAsApi(d, 'sys_user_preference', {
        id: 'p2',
        organization_id: 'org_yi',
        user_id: 'zhangsan',
        key: 'ui.recent',
      });
      expect([jia.status, yi.status]).toEqual([201, 201]);

      // Two independent rows, one per organization — the console feature works.
      const rows = await d.find('sys_user_preference', {});
      expect(
        rows
          .filter((r: any) => r.key === 'ui.recent')
          .map((r: any) => r.organization_id)
          .sort(),
      ).toEqual(['org_jia', 'org_yi']);
    });

    it('AFTER (anti-vacuity): the same key twice in ONE organization is still refused', async () => {
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(
        (await createAsApi(d, 'sys_user_preference', {
          id: 'p1',
          organization_id: 'org_jia',
          user_id: 'zhangsan',
          key: 'ui.recent',
        })).status,
      ).toBe(201);
      const duplicate = await createAsApi(d, 'sys_user_preference', {
        id: 'p2',
        organization_id: 'org_jia',
        user_id: 'zhangsan',
        key: 'ui.recent',
      });
      expect(duplicate).toMatchObject(CONFLICT_ENVELOPE);

      // …and a DIFFERENT user in the same organization is unaffected: the
      // constraint still keys on `user_id`, not on the organization alone.
      expect(
        (await createAsApi(d, 'sys_user_preference', {
          id: 'p3',
          organization_id: 'org_jia',
          user_id: 'lisi',
          key: 'ui.recent',
        })).status,
      ).toBe(201);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. The migration — deployed indexes, staged
  // ─────────────────────────────────────────────────────────────────────────

  describe('migration on a database built before the respelling', () => {
    /** A database carrying the PRE-fix physical shape plus real rows. */
    const seedDeployed = async (d: SqlDriver) => {
      await d.initObjects(PRE_FIX_APP as any);
      await d.create('sys_user_preference', {
        id: 'p1',
        organization_id: 'org_jia',
        user_id: 'zhangsan',
        key: 'ui.recent',
      } as any);
      await d.create('sys_user_preference', {
        id: 'p2',
        organization_id: 'org_jia',
        user_id: 'zhangsan',
        key: 'ui.theme',
      } as any);
    };

    it('is planned as ONE pure relaxation, categorised safe — not a destructive orphan drop', async () => {
      const d = makeDriver();
      await seedDeployed(d);
      // The new metadata arrives (a deploy), same database.
      await d.initObjects(FIXED_APP as any);

      const drift = await d.detectManagedDrift();
      // ONE finding for the table, not two. The composite was already
      // materialized additively at boot, so nothing reports it missing, and the
      // legacy index is `explained` by the replacement rather than falling
      // through to orphan detection.
      expect(drift.filter((e) => e.table === 'sys_user_preference')).toHaveLength(1);
      const entry = drift.find(
        (e) => e.table === 'sys_user_preference' && e.op.type === 'replace_unique_index',
      );
      expect(entry, 'the respelling must be a replacement, not two unrelated findings').toBeDefined();
      expect(entry!.category).toBe('safe');
      expect(entry!.op).toMatchObject({
        dropIndexNames: ['uniq_sys_user_preference_user_id_key'],
        createIndexName: 'uniq_sys_user_preference_organization_id_user_id_key',
        createColumns: ['organization_id', 'user_id', 'key'],
        nullSafeColumns: ['organization_id'],
      });

      // The old index must NOT be reported as an orphan as well. An orphan drop
      // is `destructive`, so an operator applying only the safe half would keep
      // the global index — i.e. keep the defect — while the plan read as
      // applied. This is the whole reason the declared-index arm exists.
      expect(
        drift.filter(
          (e) =>
            e.op.type === 'drop_index' &&
            (e.op as any).indexName === 'uniq_sys_user_preference_user_id_key',
        ),
      ).toHaveLength(0);
    });

    it('applies WITHOUT --allow-destructive, keeps every row, and converges', async () => {
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(FIXED_APP as any);

      const drift = await d.detectManagedDrift();
      const { applied, skipped } = await d.applyMigrationEntries(drift, { allowDestructive: false });
      expect(applied.some((e) => e.op.type === 'replace_unique_index')).toBe(true);
      expect(skipped).toHaveLength(0);

      expect(await uniqueKeyParts('sys_user_preference')).toEqual({
        uniq_sys_user_preference_organization_id_user_id_key: [
          'COALESCE(organization_id)',
          'user_id',
          'key',
        ],
      });
      expect(await d.count('sys_user_preference', {})).toBe(2);

      // Re-running finds nothing: the plan is not a drop/create cycle.
      expect(await d.detectManagedDrift()).toHaveLength(0);
    });

    it('after applying, BOTH halves hold on the migrated database', async () => {
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(FIXED_APP as any);
      await d.applyMigrationEntries(await d.detectManagedDrift(), { allowDestructive: false });

      // The fix: the second organization can now hold the colliding key.
      expect(
        (await createAsApi(d, 'sys_user_preference', {
          id: 'p3',
          organization_id: 'org_yi',
          user_id: 'zhangsan',
          key: 'ui.recent',
        })).status,
      ).toBe(201);

      // The anti-vacuity arm, on the SAME migrated index.
      expect(
        await createAsApi(d, 'sys_user_preference', {
          id: 'p4',
          organization_id: 'org_jia',
          user_id: 'zhangsan',
          key: 'ui.recent',
        }),
      ).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('boot creates the replacement ADDITIVELY, so both indexes stand until the plan runs', async () => {
      // The staging, stated as an assertion. `initObjects` is additive-only: it
      // materializes the newly-declared composite at boot and never drops
      // anything. The composite is a pure relaxation of the index already
      // there, so the create cannot fail on existing data. What the PLAN then
      // owns is only the retirement of the superseded global index — which is
      // why the operator-visible step is `safe` and why the constraint is
      // continuously enforced across the whole migration.
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(FIXED_APP as any);

      expect(Object.keys(await uniqueKeyParts('sys_user_preference')).sort()).toEqual([
        'uniq_sys_user_preference_organization_id_user_id_key',
        'uniq_sys_user_preference_user_id_key',
      ]);
      // Until the retirement is applied the OLD index is still enforcing, so
      // the defect is still live — the fix is not complete at boot.
      expect(
        await createAsApi(d, 'sys_user_preference', {
          id: 'p3',
          organization_id: 'org_yi',
          user_id: 'zhangsan',
          key: 'ui.recent',
        }),
      ).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('DROP happens only once the replacement is confirmed present', async () => {
      // The safety argument, in the direction that can actually go wrong: if
      // the replacement is not there, the legacy index must be left alone
      // rather than dropped into a gap with no uniqueness at all.
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(FIXED_APP as any);
      const drift = await d.detectManagedDrift();

      // Simulate a replacement that is not present and cannot be created (the
      // real cause is `syncDeclaredIndexes` skipping an index whose column was
      // never materialized).
      const k = (d as any).knex;
      await k.raw('DROP INDEX uniq_sys_user_preference_organization_id_user_id_key');
      (d as any).syncDeclaredIndexes = async () => undefined;

      const { applied, skipped } = await d.applyMigrationEntries(drift, { allowDestructive: false });
      const isPreferenceReplace = (e: { table: string; op: { type: string } }) =>
        e.table === 'sys_user_preference' && e.op.type === 'replace_unique_index';
      expect(applied.some(isPreferenceReplace)).toBe(false);
      expect(skipped.some(isPreferenceReplace)).toBe(true);

      // The pre-migration constraint is intact: the database is never left
      // with neither index.
      expect(Object.keys(await uniqueKeyParts('sys_user_preference'))).toEqual([
        'uniq_sys_user_preference_user_id_key',
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Guards on the new declared-index arm
  // ─────────────────────────────────────────────────────────────────────────

  describe('what the declared-index replacement must NOT claim', () => {
    const physicalColumns = new Set(['organization_id', 'user_id', 'key', 'name']);

    it('proposes the retirement for an unnamed `organization` index', () => {
      const [entry, ...rest] = legacyUniqueReplacements({
        table: 'sys_user_preference',
        fields: {},
        tenantField: 'organization_id',
        physicalColumns,
        declaredIndexes: [{ fields: ['user_id', 'key'], unique: 'organization' }],
      });
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({
        legacyColumns: ['user_id', 'key'],
        legacyNames: ['uniq_sys_user_preference_user_id_key'],
        replacement: { name: 'uniq_sys_user_preference_organization_id_user_id_key' },
      });
    });

    it('claims nothing for an EXPLICITLY NAMED index — that transition is a recreate', () => {
      // The name does not change, so there is no second index to retire.
      // Proposing one would ask to drop the very index being rebuilt.
      expect(
        legacyUniqueReplacements({
          table: 'sys_user_preference',
          fields: {},
          tenantField: 'organization_id',
          physicalColumns,
          declaredIndexes: [
            { name: 'uniq_pref_user_key', fields: ['user_id', 'key'], unique: 'organization' },
          ],
        }),
      ).toEqual([]);
    });

    it('claims nothing for the S6 hand-written composite (the legacy name IS the current name)', () => {
      expect(
        legacyUniqueReplacements({
          table: 'sys_user_preference',
          fields: {},
          tenantField: 'organization_id',
          physicalColumns,
          declaredIndexes: [{ fields: ['user_id', 'organization_id'], unique: 'organization' }],
        }),
      ).toEqual([]);
    });

    it('claims nothing when metadata ALSO declares the global index under that name (#3955)', () => {
      // Declaring both scopes is a lint contradiction, not a licence to drop
      // the one the author is still asking for.
      expect(
        legacyUniqueReplacements({
          table: 'sys_user_preference',
          fields: {},
          tenantField: 'organization_id',
          physicalColumns,
          declaredIndexes: [
            { fields: ['user_id', 'key'], unique: 'organization' },
            { fields: ['user_id', 'key'], unique: 'global' },
          ],
        }),
      ).toEqual([]);
    });

    it('claims nothing for a bare `true` declaration — the bare spelling is untouched (#5082)', () => {
      // #8323 respells two platform objects; it does NOT reinterpret bare
      // `true`. That question belongs to #5082 and stays there.
      expect(
        legacyUniqueReplacements({
          table: 'sys_user_preference',
          fields: {},
          tenantField: 'organization_id',
          physicalColumns,
          declaredIndexes: [{ fields: ['user_id', 'key'], unique: true }],
        }),
      ).toEqual([]);
    });

    it('does not fire on a table with no tenant column', () => {
      expect(
        legacyUniqueReplacements({
          table: 'sys_user_preference',
          fields: {},
          tenantField: null,
          physicalColumns,
          declaredIndexes: [{ fields: ['user_id', 'key'], unique: 'organization' }],
        }),
      ).toEqual([]);
    });

    it('leaves a same-named index alone when its COLUMNS are not the shape being replaced', async () => {
      // Name matching alone is not enough: a physical index that happens to
      // carry the generated spelling but keys on other columns is somebody
      // else's index, and dropping it would be a pure mistake.
      const d = makeDriver();
      await d.initObjects([
        {
          name: 'sys_user_preference',
          fields: {
            id: { type: 'string' },
            organization_id: { type: 'string' },
            user_id: { type: 'string' },
            key: { type: 'string' },
          },
        },
      ] as any);
      const k = (d as any).knex;
      await k.raw('CREATE UNIQUE INDEX uniq_sys_user_preference_user_id_key ON sys_user_preference (user_id)');
      await d.initObjects(FIXED_APP as any);

      const drift = await d.detectManagedDrift();
      expect(
        drift.filter((e) => e.table === 'sys_user_preference' && e.op.type === 'replace_unique_index'),
      ).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. ADR-0120's invariant still holds for the new shape
  // ─────────────────────────────────────────────────────────────────────────

  describe('postureIndependence', () => {
    it('materializes the same key parts under single / group / isolated', async () => {
      const shapes: Record<string, Record<string, string[]>> = {};
      for (const posture of ['single', 'group', 'isolated'] as const) {
        process.env.OS_TENANCY_POSTURE = posture;
        if (posture === 'single') delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = 'true';

        const d = makeDriver();
        await d.initObjects(FIXED_APP as any);
        shapes[posture] = await uniqueKeyParts('sys_user_preference');
        await d.disconnect();
        driver = undefined;
      }
      // Positively asserted, not merely "all three agree" — three empty maps
      // would satisfy sameness alone.
      expect(shapes.single).toEqual({
        uniq_sys_user_preference_organization_id_user_id_key: [
          'COALESCE(organization_id)',
          'user_id',
          'key',
        ],
      });
      expect(shapes.group).toEqual(shapes.single);
      expect(shapes.isolated).toEqual(shapes.single);
    });
  });
});
