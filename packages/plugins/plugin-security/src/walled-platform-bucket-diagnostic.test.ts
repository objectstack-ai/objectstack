// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11532] A FRESH walled deployment mints the PLATFORM BUCKET
 * organization-less — and the per-organization pass must stop calling the
 * platform's own output a "pre-fix leftover" with a remedy that recreates it.
 *
 * ## What was measured on a real deployment
 *
 * A fresh boot of the walled HotCRM SaaS rig (`OS_TENANCY_POSTURE=isolated`,
 * three organizations, one SQLite file) stored 50 `sys_permission_set` rows:
 * 14 x 3 organizations, plus **8 organization-less** ones carrying
 * `managed_by = 'platform'` / `package_id = NULL`, written 1.3 s BEFORE the
 * deployment's first `sys_organization` row existed. `bootstrapPlatformAdmin`
 * wrote them — it is the fifth seeder, outside the four #11121 converted, and
 * its own log line names the count (`{"seeded":8,...}`).
 *
 * ## What is NOT in scope here, and why the minting is left alone
 *
 * ⛔ Routing that seeding through the per-organization pass is **ruled out of
 * this landing**. #10103's maintainer ruling of 2026-08-20 (Q1/Q2, live
 * decision-inbox session) closes it verbatim:
 *
 *   > Q1's platform-defaults residue (`bootstrapPlatformAdmin`'s three sets,
 *   > the env-door projection) stays outside this card, unreaped and loudly
 *   > warned about under walled posture; whether customers ever need those
 *   > visible is a future small decision card, filed only when an onboarding
 *   > flow actually wants it.
 *
 * The rows are also load-bearing: PLATFORM_ADMIN is DERIVED from an unscoped
 * `sys_user_permission_set` grant pointing at the organization-less
 * `admin_full_access` row BY ROW ID (`resolve-authz-context.ts` section 6b),
 * which is the same reason the ruled Option C refused a #8617-breadth reap.
 *
 * So section 1 pins the minting as CURRENT, RULED behaviour — by row identity,
 * not by count, because two offsetting errors hold a count constant while the
 * identity inverts. What this card repairs is section 3: the diagnostic.
 *
 * ## Why the diagnostic could not be measured with the diagnostic
 *
 * The pass's own verdict is self-falsifying — it reports the platform's output
 * of 1.3 s earlier as legacy state the operator never had, and offers
 * "re-initialize the deployment", which mints exactly these rows again on the
 * next boot. Its output therefore cannot serve as evidence for anything,
 * including that this fix worked. Every assertion below reads STORED ROWS off
 * knex (past every engine-side projection) or the logger's recorded calls —
 * never the pass's summary.
 *
 * ## Why a real engine and a real driver
 *
 * The defect lives where a scope the ENGINE threads meets a predicate the
 * DRIVER emits, exactly as in `per-organization-catalog.test.ts`. A hand-built
 * engine double implements neither, so these cases run a real `SqlDriver` on
 * better-sqlite3 `:memory:` behind a real `ObjectQL`, drive the SHIPPED
 * seeders, and seed from the SHIPPED `defaultPermissionSets` — the same array
 * `security-plugin.ts` hands to `bootstrapPlatformAdmin` and puts on the
 * manifest as `permissions`.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import { bootstrapDeclaredPermissions } from './bootstrap-declared-permissions.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysOrganization, SysUser } from '@objectstack/platform-objects/identity';

const ORGS = ['org_jia', 'org_yi', 'org_bing'] as const;
const SECURITY_PACKAGE = 'com.objectstack.plugin-security';

/** The platform bucket's names, read off the SHIPPED declaration. */
const PLATFORM_BUCKET_NAMES = defaultPermissionSets.map((ps) => ps.name).sort();

/**
 * One extra declared set that the platform bootstrap does NOT seed. It is the
 * positive control for the OTHER class: a genuine pre-fix organization-less
 * row, for which "re-initialize the deployment" remains the correct remedy and
 * must keep being offered.
 */
const ACME_SET = { name: 'acme_readonly', label: 'Acme RO', _packageId: 'com.acme.crm', objects: {} };

/**
 * What `manifest.register({ permissions: this.bootstrapPermissionSets })`
 * produces: the platform bucket's own declarations, provenance-stamped for
 * plugin-security, plus one foreign package's set.
 */
const DECLARED_PERMISSIONS = [
  ...defaultPermissionSets.map((ps) => ({ ...(ps as any), _packageId: SECURITY_PACKAGE })),
  ACME_SET,
];

function recordingLogger() {
  const warns: Array<{ message: string; meta: any }> = [];
  const infos: Array<{ message: string; meta: any }> = [];
  return {
    warns,
    infos,
    logger: {
      info: (message: string, meta?: any) => { infos.push({ message, meta }); },
      warn: (message: string, meta?: any) => { warns.push({ message, meta }); },
      error: (_m: string, _meta?: any) => { /* the walled "ZERO config-derived platform administrators" backstop — over CONFIGURATION, not elevation; not this card's subject */ },
    },
  };
}

const engines: ObjectQL[] = [];
let posture: string | undefined;

beforeEach(() => {
  posture = process.env.OS_TENANCY_POSTURE;
  process.env.OS_TENANCY_POSTURE = 'isolated';
});

afterEach(async () => {
  if (posture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = posture;
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.walled-platform-bucket-11532',
    name: 'Walled platform bucket',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPermissionSet, SysUserPermissionSet, SysOrganization, SysUser],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  return engine;
}

/**
 * The delegating seam `per-organization-catalog.test.ts` uses: every verb
 * reaches the real ObjectQL, `update` opens with the PRODUCER's own dispatch
 * predicate, and `registry` answers `readDeclared`.
 */
function withRegistry(engine: any, declared: any[] = DECLARED_PERMISSIONS): any {
  return {
    find: (o: string, q?: any, opt?: any) => engine.find(o, q, opt),
    insert: (o: string, d: any, opt?: any) => engine.insert(o, d, opt),
    update: (o: string, d: any, opt?: any) => {
      assertEngineUpdateDispatch(d, opt);
      return engine.update(o, d, opt);
    },
    registry: { listItems: (type: string) => (type === 'permission' ? declared : []) },
  };
}

/** Ground truth: every stored row, straight off knex, past all tenancy. */
async function stored(engine: ObjectQL, table = 'sys_permission_set'): Promise<any[]> {
  const driver: any = (engine as any).getDriver(table);
  return driver.knex(table).select('*');
}

const orgOf = (r: any): string | null => (r.organization_id ?? null);
const orgLess = (rows: any[]) => rows.filter((r) => orgOf(r) === null);

/** The boot order `security-plugin.ts` runs: platform bootstrap, then one pass per organization. */
async function walledBoot(engine: ObjectQL, logger: any): Promise<{ seeded: number }> {
  const ql = withRegistry(engine);
  for (const org of ORGS) {
    await (engine as any).insert('sys_organization', { id: org, name: org }, { context: { isSystem: true } });
  }
  const report = await bootstrapPlatformAdmin(ql, defaultPermissionSets as any[], { logger });
  for (const org of ORGS) {
    await bootstrapDeclaredPermissions(ql, null, { logger, organizationId: org });
  }
  return { seeded: report.seeded };
}

/** The one warning class this card is about, whatever wording it ends up carrying. */
const bucketWarns = (warns: Array<{ message: string; meta: any }>) =>
  warns.filter((w) => (w.meta?.names ?? []).some((n: string) => PLATFORM_BUCKET_NAMES.includes(n)));

describe('[#11532] the walled platform bucket and the diagnostic that describes it', () => {
  it('1. PREMISE (ruled, unchanged): a fresh walled boot mints the platform bucket organization-less — pinned by ROW IDENTITY, not count', async () => {
    const engine = await boot();
    const { logger, infos } = recordingLogger();

    const { seeded } = await walledBoot(engine, logger);
    const rows = await stored(engine);
    const bucket = orgLess(rows);

    // (a) IDENTITY, name by name — a count would hold constant under two
    // offsetting errors while the membership inverted.
    expect(bucket.map((r) => r.name).sort()).toEqual(PLATFORM_BUCKET_NAMES);
    expect(seeded).toBe(PLATFORM_BUCKET_NAMES.length);
    // The eight names the rig measured are named literally, so a silent change
    // to the shipped declaration cannot quietly redefine what this pins.
    expect(PLATFORM_BUCKET_NAMES).toEqual([
      'admin_full_access',
      'mcp_agent_data_read',
      'mcp_agent_data_write',
      'mcp_agent_restricted',
      'member_default',
      'organization_admin',
      'organization_admin_no_bypass',
      'viewer_readonly',
    ]);

    // (b) The provenance the rig measured: platform-owned, no package.
    for (const row of bucket) {
      expect(row.managed_by).toBe('platform');
      expect(row.package_id ?? null).toBeNull();
    }

    // (c) Every organization still holds its OWN complete copy, package-owned —
    // which is why nothing is broken for a reader and why the bucket is not
    // reaped. Identity again: the per-organization row is a DIFFERENT row id.
    const bucketIds = new Set(bucket.map((r) => r.id));
    for (const org of ORGS) {
      const own = rows.filter((r) => orgOf(r) === org);
      expect(own.map((r) => r.name).sort()).toEqual([...PLATFORM_BUCKET_NAMES, ACME_SET.name].sort());
      for (const r of own) {
        expect(bucketIds.has(r.id)).toBe(false);
        expect(r.managed_by).toBe('package');
      }
      expect(own.filter((r) => r.name === 'admin_full_access')[0].package_id).toBe(SECURITY_PACKAGE);
    }

    // (d) The PRODUCER says what it wrote. The rig's boot log read
    // `{"seeded":8}` with nothing to indicate the rows carried no organization,
    // so the operator's first sight of them was a warning calling them legacy
    // state. Under a walled posture the seeder now names the bucket itself.
    const declared = infos.filter((i) => i.message.includes('the platform bucket'));
    expect(declared).toHaveLength(1);
    expect([...(declared[0].meta?.names ?? [])].sort()).toEqual(PLATFORM_BUCKET_NAMES);
    expect(declared[0].meta?.seeded).toBe(PLATFORM_BUCKET_NAMES.length);
  });

  it('2. the per-organization sweep leaves the platform bucket ROWS untouched — same ids, same values', async () => {
    const engine = await boot();
    const { logger } = recordingLogger();
    const ql = withRegistry(engine);
    for (const org of ORGS) {
      await (engine as any).insert('sys_organization', { id: org, name: org }, { context: { isSystem: true } });
    }

    await bootstrapPlatformAdmin(ql, defaultPermissionSets as any[], { logger });
    const before = JSON.stringify(orgLess(await stored(engine)).map((r) => ({ ...r })).sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)));

    for (const org of ORGS) await bootstrapDeclaredPermissions(ql, null, { logger, organizationId: org });
    const after = JSON.stringify(orgLess(await stored(engine)).map((r) => ({ ...r })).sort((a, b) => `${a.id}`.localeCompare(`${b.id}`)));

    // Byte-equal: not reaped, not adopted, not re-stamped. The bucket is exactly
    // what the ruling said it would be, and its ids are still what the unscoped
    // PLATFORM_ADMIN grant points at.
    expect(after).toBe(before);
  });

  it('3. THE FIX: the platform bucket is NOT reported as a pre-fix leftover, and its remedy is not the loop', async () => {
    const engine = await boot();
    const { logger, warns } = recordingLogger();
    await walledBoot(engine, logger);

    const guard = bucketWarns(warns);
    // Once per organization — the guard is per pass, and silence would be the
    // OTHER failure (the ruling requires these rows be warned about loudly).
    expect(guard).toHaveLength(ORGS.length);

    for (const org of ORGS) {
      const forOrg = guard.filter((w) => w.meta?.organization === org);
      expect(forOrg).toHaveLength(1);
      const [w] = forOrg;
      // (a) Every platform-bucket name is named — loudly, by name, as ruled.
      expect([...(w.meta.names ?? [])].sort()).toEqual(PLATFORM_BUCKET_NAMES);
      expect(w.meta.count).toBe(PLATFORM_BUCKET_NAMES.length);

      // (b) NOT pre-fix. On a fresh deployment there are no pre-fix rows; these
      // were minted by this same boot, seconds earlier. Asserted on the
      // MACHINE-READABLE classification rather than on prose, so a reworded
      // message cannot quietly re-merge the two classes.
      expect(w.meta.origin).toBe('platform-bucket');
      expect(w.message).toContain('PLATFORM BUCKET');
      expect(w.message).toContain('on every boot');
      expect(w.message).not.toContain('pre-fix organization-less');

      // (c) The remedy is not the loop. "Remedy: re-initialize the deployment"
      // recreates exactly these rows on the next boot, so it is not offered.
      expect(w.message).not.toContain('Remedy: re-initialize the deployment');
      expect(w.message).toContain('Re-initializing the deployment does NOT clear');

      // (d) …and the reader is told the thing that actually matters: their own
      // catalog is complete, so no action is required.
      expect(w.message).toContain("own copies WERE created");
      expect(w.message).toContain('no action is required');
    }
  });

  it('4. POSITIVE CONTROL: a genuine pre-fix organization-less row still gets the original wording AND the re-initialize remedy', async () => {
    const engine = await boot();
    const { logger, warns } = recordingLogger();
    const ql = withRegistry(engine);
    for (const org of ORGS) {
      await (engine as any).insert('sys_organization', { id: org, name: org }, { context: { isSystem: true } });
    }

    // A pre-fix deployment: ONE organization-less pass through the SHIPPED
    // seeder, the pre-#11121 behaviour, carrying only the foreign package's
    // set. `acme_readonly` is not in the platform bucket, so its leftover is
    // the real thing — a re-initialized deployment really would not have it.
    await bootstrapDeclaredPermissions(withRegistry(engine, [ACME_SET]), null, { logger });
    expect(orgLess(await stored(engine)).map((r) => r.name)).toEqual([ACME_SET.name]);

    warns.length = 0;
    await bootstrapPlatformAdmin(ql, defaultPermissionSets as any[], { logger });
    for (const org of ORGS) await bootstrapDeclaredPermissions(ql, null, { logger, organizationId: org });

    const preFix = warns.filter((w) => (w.meta?.names ?? []).includes(ACME_SET.name));
    expect(preFix).toHaveLength(ORGS.length);
    for (const w of preFix) {
      expect(w.meta.origin).toBe('pre-fix-residue');
      expect(w.message).toContain('pre-fix organization-less');
      expect(w.message).toContain('re-initialize the deployment');
      expect(w.message).toContain('adopt');
      expect(w.message).toContain('NOT deleted');
      // The two classes are reported SEPARATELY: a pre-fix warning that also
      // carried the platform bucket's names would hand the operator a remedy
      // that is a loop for most of the list it prints.
      expect([...(w.meta.names ?? [])]).toEqual([ACME_SET.name]);
    }
  });

  it('5. `single` posture is untouched: organization-less is the correct shape there, and nothing is warned', async () => {
    const engine = await boot();
    const { logger, warns, infos } = recordingLogger();
    const ql = withRegistry(engine);
    process.env.OS_TENANCY_POSTURE = 'single';

    await bootstrapPlatformAdmin(ql, defaultPermissionSets as any[], { logger });
    await bootstrapDeclaredPermissions(ql, null, { logger });

    const rows = await stored(engine);
    expect(rows.every((r) => orgOf(r) === null)).toBe(true);
    expect(warns.filter((w) => (w.meta?.names ?? []).length > 0)).toEqual([]);
    // …and the producer's walled-only declaration stays silent here: an
    // organization-less row is the CORRECT shape under `single`.
    expect(infos.filter((i) => i.message.includes('the platform bucket'))).toEqual([]);
  });

  it('6. a host that OVERRODE the default sets is classified against ITS array, not the shipped one', async () => {
    const engine = await boot();
    const { logger, warns } = recordingLogger();
    const ql = withRegistry(engine);
    for (const org of ORGS) {
      await (engine as any).insert('sys_organization', { id: org, name: org }, { context: { isSystem: true } });
    }

    // The counterfactual `SecurityPluginOptions.defaultPermissionSets` creates:
    // the organization-less writer seeds a DIFFERENT list, so `acme_readonly`
    // becomes the re-minted name and the shipped eight become genuine leftovers.
    await bootstrapDeclaredPermissions(withRegistry(engine, [ACME_SET]), null, { logger });
    await bootstrapPlatformAdmin(ql, defaultPermissionSets as any[], { logger });

    warns.length = 0;
    for (const org of ORGS) {
      await bootstrapDeclaredPermissions(ql, null, {
        logger,
        organizationId: org,
        platformBucketNames: [ACME_SET.name],
      });
    }

    const bucket = warns.filter((w) => w.meta?.origin === 'platform-bucket');
    const preFix = warns.filter((w) => w.meta?.origin === 'pre-fix-residue');
    expect(bucket).toHaveLength(ORGS.length);
    expect(preFix).toHaveLength(ORGS.length);
    for (const w of bucket) expect([...(w.meta.names ?? [])]).toEqual([ACME_SET.name]);
    // Positive control on the same run: the shipped eight are NOT silently
    // swallowed — they move to the other class rather than disappearing.
    for (const w of preFix) expect([...(w.meta.names ?? [])].sort()).toEqual(PLATFORM_BUCKET_NAMES);
  });
});
