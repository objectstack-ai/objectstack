// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver, classifyIndexKeyPart, parseIndexDdl, legacyUniqueReplacements } from '../src/index.js';

/**
 * #8468 — `sys_position.name`, the THIRD instance of the #8323 class.
 *
 * ## What was measured here, live, before the fix
 *
 * The card was filed from a STATIC read and said so; the maintainer ruling of
 * 2026-08-13 made the fix conditional on a live probe reproducing the oracle
 * first. It does. Driving the real shipped declaration through this driver on
 * `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_position_name on sys_position (name)   ← installation-wide
 *
 * org_jia POST name=probe_pos_xtenant   → 201
 * org_yi  POST the SAME name            → 409 UNIQUE_VIOLATION
 * org_yi  POST an unused name           → 201
 * org_yi  GET  that name                → total 0
 * ```
 *
 * A per-value refusal on a row the caller cannot read is a cross-tenant
 * existence oracle; the 201 control is what makes it an oracle rather than a
 * blanket refusal. It is also a plain dead end — the second organization could
 * never name a position `sales_manager` if any other organization already had,
 * and the 409 does not say why.
 *
 * ## Why the declaration was global
 *
 * The same deliberate divergence #8323 documents: a DECLARED index's bare
 * `unique: true` is the positional spelling of `'global'` and takes the listed
 * columns VERBATIM, while FIELD-level `unique: true` has meant per-organization
 * since #3696. `packages/lint/src/data-model-rules.ts` calls this "the #4986
 * trap"; `sys_position` was its third instance in the platform's own metadata,
 * after `sys_user_preference` and `sys_capability` (#8461).
 *
 * The hierarchy counter-argument raised during triage does not apply to this
 * object at all: positions are deliberately FLAT (ADR-0090 D3, finalizing
 * ADR-0057 D5). There is no `parent_id` on `sys_position` and no position tree,
 * so there is no shared-namespace argument to weigh.
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
 * ## The half that a fresh-database suite cannot see
 *
 * #8323's most expensive finding was that changing the declaration alone passes
 * every behavioural test on a fresh database and leaves every DEPLOYED
 * installation still enumerable: respelling changes the index's generated NAME,
 * so drift reads as two findings — composite missing (safe, auto-applied) and
 * old global index orphaned (destructive, opt-in) — and an operator applying
 * only the safe half keeps the defect while the plan reads as applied. The
 * `migration on a database built before the respelling` block below is
 * therefore the load-bearing part of this file, not an addendum: it builds an
 * installation that ALREADY HAS `uniq_sys_position_name` and real rows, then
 * migrates it.
 */

/** The wire shape a duplicate insert must produce, per `rest-server.ts`. */
const CONFLICT_ENVELOPE = { status: 409, code: 'UNIQUE_VIOLATION' } as const;

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

/** Physical columns of `sys_position` that carry the constraint. */
const POSITION_FIELDS = {
  id: { type: 'string' },
  organization_id: { type: 'string' },
  name: { type: 'string' },
  label: { type: 'string' },
  managed_by: { type: 'string' },
  active: { type: 'boolean' },
} as const;

/**
 * The shipped declaration, reduced to the entry that carries the constraint.
 * Copying rather than importing keeps the package boundary — the shape #8461
 * used.
 *
 * ⚠️ The copy is guarded in ONE direction only. `sys-position.organization-unique.test.ts`
 * in `plugin-security` pins the real `SysPosition.indexes` against its own inline
 * literal, so a change to the SHIPPED DECLARATION that is not mirrored here goes
 * red over there. The reverse is unguarded: if `FIXED_APP` below is edited and the
 * declaration is not, nothing compares them and this suite will go on proving
 * something about a fixture nobody ships. Treat this block as hand-maintained,
 * and change it only together with the declaration.
 *
 * The `unique: false` on the second entry is not decoration: `ObjectSchema.create`
 * normalizes the authored `{ fields: ['active'] }` into that shape, so this is
 * what a driver is actually handed at registration.
 */
const PRE_FIX_APP = [
  {
    name: 'sys_position',
    fields: POSITION_FIELDS,
    indexes: [
      { fields: ['name'], unique: true }, // ← the defect
      { fields: ['active'], unique: false },
    ],
  },
] as const;

const FIXED_APP = [
  {
    name: 'sys_position',
    fields: POSITION_FIELDS,
    indexes: [
      { fields: ['name'], unique: 'organization' },
      { fields: ['active'], unique: false },
    ],
  },
] as const;

describe('#8468 — sys_position.name is unique per organization, not per installation', () => {
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
    // The posture the probe was run on. ADR-0120's invariant is that no index
    // shape reads the posture — `postureIndependence` below pins that — so this
    // is context for the reader, not an input the assertions depend on.
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

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Materialized shape — both spellings, kept side by side
  // ───────────────────────────────────────────────────────────────────────────

  describe('materialized shape', () => {
    it('the fixed declaration keys on the NULL-safe organization part', async () => {
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(await uniqueKeyParts('sys_position')).toEqual({
        uniq_sys_position_organization_id_name: ['COALESCE(organization_id)', 'name'],
      });
    });

    it('the pre-fix declaration keyed on the bare business column — installation-wide', async () => {
      // Kept permanently rather than measured once: this is the contrast that
      // makes every "AFTER" assertion below mean something.
      const d = makeDriver();
      await d.initObjects(PRE_FIX_APP as any);

      expect(await uniqueKeyParts('sys_position')).toEqual({
        uniq_sys_position_name: ['name'],
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. The card's reproduction — the live probe the ruling required
  // ───────────────────────────────────────────────────────────────────────────

  describe('the cross-organization existence oracle', () => {
    it('BEFORE: a name held by another organization is refused — 409 on a row you cannot read', async () => {
      const d = makeDriver();
      await d.initObjects(PRE_FIX_APP as any);

      const first = await createAsApi(d, 'sys_position', {
        id: 'pos1',
        organization_id: 'org_jia',
        name: 'sales_manager',
        label: 'Sales Manager',
      });
      expect(first.status).toBe(201);

      const crossOrg = await createAsApi(d, 'sys_position', {
        id: 'pos2',
        organization_id: 'org_yi',
        name: 'sales_manager',
        label: 'Sales Manager',
      });
      expect(crossOrg).toMatchObject(CONFLICT_ENVELOPE);

      // The control that makes the refusal an ORACLE rather than a blanket
      // rejection: an unused name from the same caller is accepted, so the 409
      // is a per-value answer about another tenant's data.
      const control = await createAsApi(d, 'sys_position', {
        id: 'pos3',
        organization_id: 'org_yi',
        name: 'position_only_in_b',
        label: 'Other',
      });
      expect(control.status).toBe(201);

      // …and the other half of the oracle: the caller's own read of the
      // colliding name returns nothing. It is refused by a row it cannot see.
      const visible = (await d.find('sys_position', {})).filter(
        (r: any) => r.organization_id === 'org_yi' && r.name === 'sales_manager',
      );
      expect(visible).toHaveLength(0);
    });

    it('AFTER: the same cross-organization create is accepted — 409 flips to 201', async () => {
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(
        (await createAsApi(d, 'sys_position', {
          id: 'pos1', organization_id: 'org_jia', name: 'sales_manager', label: 'Sales Manager',
        })).status,
      ).toBe(201);
      expect(
        (await createAsApi(d, 'sys_position', {
          id: 'pos2', organization_id: 'org_yi', name: 'sales_manager', label: 'Sales Manager',
        })).status,
      ).toBe(201);

      const held = (await d.find('sys_position', {})).filter((r: any) => r.name === 'sales_manager');
      expect(held.map((r: any) => r.organization_id).sort()).toEqual(['org_jia', 'org_yi']);
    });

    it('AFTER (anti-vacuity): a SAME-organization duplicate is still refused', async () => {
      // If this ever goes green-by-acceptance the constraint was REMOVED, not
      // scoped — strictly worse than the defect being fixed, and indistinguishable
      // from the fix by the 409-flips-to-201 assertion alone.
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(
        (await createAsApi(d, 'sys_position', {
          id: 'pos1', organization_id: 'org_jia', name: 'sales_manager', label: 'Sales Manager',
        })).status,
      ).toBe(201);
      const sameOrg = await createAsApi(d, 'sys_position', {
        id: 'pos2', organization_id: 'org_jia', name: 'sales_manager', label: 'Duplicate',
      });
      expect(sameOrg).toMatchObject(CONFLICT_ENVELOPE);
      expect(await d.count('sys_position', {})).toBe(1);
    });

    it('AFTER: platform-seeded rows carry no organization and stay unique among THEMSELVES (D3)', async () => {
      // `bootstrapBuiltinRoles` seeds the framework-reserved identity positions
      // (platform_admin / org_*) and the ADR-0090 D9 audience anchors
      // (everyone / guest) with `managed_by: 'platform'` and no organization.
      // A bare `(organization_id, name)` composite would be NULL-DISTINCT under
      // SQL, so every seeded position could be duplicated at will; the NULL-safe
      // key part is what prevents that, and the bootstrap upsert-by-name relies
      // on it.
      const d = makeDriver();
      await d.initObjects(FIXED_APP as any);

      expect(
        (await createAsApi(d, 'sys_position', {
          id: 'seed1', name: 'platform_admin', label: 'Platform Admin', managed_by: 'platform',
        })).status,
      ).toBe(201);
      const duplicateSeed = await createAsApi(d, 'sys_position', {
        id: 'seed2', name: 'platform_admin', label: 'Platform Admin', managed_by: 'platform',
      });
      expect(duplicateSeed).toMatchObject(CONFLICT_ENVELOPE);

      // A tenant may still author its OWN position of the same name — the
      // platform bucket and the organization buckets are separate namespaces.
      expect(
        (await createAsApi(d, 'sys_position', {
          id: 'own1', organization_id: 'org_jia', name: 'platform_admin', label: 'Local', managed_by: 'admin',
        })).status,
      ).toBe(201);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. The deployed-installation half — the #8323 trap, re-run for this object
  // ───────────────────────────────────────────────────────────────────────────

  describe('migration on a database built before the respelling', () => {
    /**
     * An installation that ALREADY HAS the old global index and real rows —
     * i.e. every deployment in the field. A fresh-provision test cannot reach
     * any of the assertions in this block.
     */
    const seedDeployed = async (d: SqlDriver) => {
      await d.initObjects(PRE_FIX_APP as any);
      await d.create('sys_position', {
        id: 'pos1', organization_id: 'org_jia', name: 'sales_manager', label: 'Sales Manager', managed_by: 'admin',
      } as any);
      await d.create('sys_position', {
        id: 'pos2', organization_id: 'org_jia', name: 'hr_specialist', label: 'HR Specialist', managed_by: 'admin',
      } as any);
      await d.create('sys_position', {
        id: 'seed1', name: 'platform_admin', label: 'Platform Admin', managed_by: 'platform',
      } as any);
    };

    it('the seeded database really carries the pre-fix index (harness guard)', async () => {
      // Without this the whole block could be exercising a fresh schema and
      // every assertion below would still pass. Named as a guard on purpose.
      const d = makeDriver();
      await seedDeployed(d);

      expect(await uniqueKeyParts('sys_position')).toEqual({ uniq_sys_position_name: ['name'] });
      expect(await d.count('sys_position', {})).toBe(3);
      // …and the defect is live on it, which is what makes migrating it matter.
      expect(
        await createAsApi(d, 'sys_position', {
          id: 'x', organization_id: 'org_yi', name: 'sales_manager', label: 'Sales Manager',
        }),
      ).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('is planned as ONE pure relaxation, categorised safe — not a destructive orphan drop', async () => {
      const d = makeDriver();
      await seedDeployed(d);
      // The new metadata arrives (a deploy), same database.
      await d.initObjects(FIXED_APP as any);

      const drift = await d.detectManagedDrift();
      expect(drift.filter((e) => e.table === 'sys_position')).toHaveLength(1);
      const entry = drift.find(
        (e) => e.table === 'sys_position' && e.op.type === 'replace_unique_index',
      );
      expect(entry, 'the respelling must be a replacement, not two unrelated findings').toBeDefined();
      expect(entry!.category).toBe('safe');
      expect(entry!.op).toMatchObject({
        dropIndexNames: ['uniq_sys_position_name'],
        createIndexName: 'uniq_sys_position_organization_id_name',
        createColumns: ['organization_id', 'name'],
        nullSafeColumns: ['organization_id'],
      });

      // ⛔ The old index must NOT ALSO surface as an orphan. An orphan drop is
      // `destructive`, so an operator applying only the safe half would keep the
      // global index — keep the defect — while the plan read as applied. That
      // is the exact failure #8323 measured, and it is what this assertion
      // exists to prevent from recurring on this object.
      expect(
        drift.filter(
          (e) => e.op.type === 'drop_index' && (e.op as any).indexName === 'uniq_sys_position_name',
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

      expect(await uniqueKeyParts('sys_position')).toEqual({
        uniq_sys_position_organization_id_name: ['COALESCE(organization_id)', 'name'],
      });
      expect(await d.count('sys_position', {})).toBe(3);

      // Re-running finds nothing: the plan is not a drop/create cycle.
      expect(await d.detectManagedDrift()).toHaveLength(0);
    });

    it('after applying, BOTH halves hold on the MIGRATED database', async () => {
      // The assertion the card is actually about: the fix reaches a deployed
      // installation, not merely a freshly provisioned one.
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(FIXED_APP as any);
      await d.applyMigrationEntries(await d.detectManagedDrift(), { allowDestructive: false });

      expect(
        (await createAsApi(d, 'sys_position', {
          id: 'pos3', organization_id: 'org_yi', name: 'sales_manager', label: 'Sales Manager',
        })).status,
      ).toBe(201);

      // The anti-vacuity arm, on the SAME migrated index.
      expect(
        await createAsApi(d, 'sys_position', {
          id: 'pos4', organization_id: 'org_jia', name: 'sales_manager', label: 'Duplicate',
        }),
      ).toMatchObject(CONFLICT_ENVELOPE);

      // …and the platform seed bucket survived the migration intact.
      expect(
        await createAsApi(d, 'sys_position', {
          id: 'seed2', name: 'platform_admin', label: 'Platform Admin', managed_by: 'platform',
        }),
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
      await d.initObjects(FIXED_APP as any);

      expect(Object.keys(await uniqueKeyParts('sys_position')).sort()).toEqual([
        'uniq_sys_position_name',
        'uniq_sys_position_organization_id_name',
      ]);
      expect(
        await createAsApi(d, 'sys_position', {
          id: 'pos3', organization_id: 'org_yi', name: 'sales_manager', label: 'Sales Manager',
        }),
      ).toMatchObject(CONFLICT_ENVELOPE);
    });

    it('DROP happens only once the replacement is confirmed present', async () => {
      // The safety argument in the direction that can actually go wrong: if the
      // replacement is not there, the legacy index must be left alone rather
      // than dropped into a gap with no uniqueness at all.
      const d = makeDriver();
      await seedDeployed(d);
      await d.initObjects(FIXED_APP as any);
      const drift = await d.detectManagedDrift();

      const k = (d as any).knex;
      await k.raw('DROP INDEX uniq_sys_position_organization_id_name');
      (d as any).syncDeclaredIndexes = async () => undefined;

      const { applied, skipped } = await d.applyMigrationEntries(drift, { allowDestructive: false });
      const isPositionReplace = (e: { table: string; op: { type: string } }) =>
        e.table === 'sys_position' && e.op.type === 'replace_unique_index';
      expect(applied.some(isPositionReplace)).toBe(false);
      expect(skipped.some(isPositionReplace)).toBe(true);

      // The pre-migration constraint is intact: never left with neither index.
      expect(Object.keys(await uniqueKeyParts('sys_position'))).toEqual(['uniq_sys_position_name']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. The #8461 guards still hold for this object (A3)
  // ───────────────────────────────────────────────────────────────────────────

  describe('the declared-index replacement arm, exercised on sys_position', () => {
    const physicalColumns = new Set(['organization_id', 'id', 'name', 'label', 'managed_by', 'active']);

    it('proposes exactly one retirement, keyed on the listed column', () => {
      const [entry, ...rest] = legacyUniqueReplacements({
        table: 'sys_position',
        fields: {},
        tenantField: 'organization_id',
        physicalColumns,
        declaredIndexes: [{ fields: ['name'], unique: 'organization' }, { fields: ['active'] }],
      } as any);
      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({
        column: 'name',
        legacyColumns: ['name'],
        legacyNames: ['uniq_sys_position_name'],
        replacement: {
          name: 'uniq_sys_position_organization_id_name',
          columns: ['organization_id', 'name'],
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
          table: 'sys_position',
          fields: {},
          tenantField: 'organization_id',
          physicalColumns,
          declaredIndexes: [{ name: 'uq_position_name', fields: ['name'], unique: 'organization' }],
        } as any),
      ).toHaveLength(0);
    });

    it('claims nothing when the legacy name IS the replacement name (the S6 composite)', () => {
      // #8461 guard 2 — what protects sys_team / sys_business_unit / sys_member.
      expect(
        legacyUniqueReplacements({
          table: 'sys_position',
          fields: {},
          tenantField: 'organization_id',
          physicalColumns,
          declaredIndexes: [{ fields: ['organization_id', 'name'], unique: 'organization' }],
        } as any),
      ).toHaveLength(0);
    });

    it('claims nothing for the BARE spelling — an unrespelled declaration is untouched (#5082)', () => {
      expect(
        legacyUniqueReplacements({
          table: 'sys_position',
          fields: {},
          tenantField: 'organization_id',
          physicalColumns,
          declaredIndexes: [{ fields: ['name'], unique: true }],
        } as any),
      ).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. ADR-0120: no index shape reads the posture
  // ───────────────────────────────────────────────────────────────────────────

  describe('postureIndependence', () => {
    it('materializes the same key parts under single / group / isolated', async () => {
      for (const posture of ['single', 'group', 'isolated']) {
        process.env.OS_TENANCY_POSTURE = posture;
        const d = makeDriver();
        await d.initObjects(FIXED_APP as any);
        expect(await uniqueKeyParts('sys_position'), `posture=${posture}`).toEqual({
          uniq_sys_position_organization_id_name: ['COALESCE(organization_id)', 'name'],
        });
        await d.disconnect();
        driver = undefined;
      }
    });
  });
});
