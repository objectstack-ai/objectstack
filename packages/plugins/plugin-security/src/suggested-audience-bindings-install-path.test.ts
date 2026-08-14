// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
// [#5619] The producer's OWN write-verb dispatch decisions. The two `ql` handles
// below are seams in front of a real engine, not fakes — but they are still
// doubles by the shape the contract gate reads, and routing their write verbs
// through the producer's predicates is what keeps a seam from accepting a call
// `ObjectQL` refuses. Imported from `@objectstack/objectql` rather than
// `@objectstack/metadata-core` (its home since #5619) on purpose: objectql
// re-exports both, it is already a devDependency of this package, and — measured,
// not assumed — `@objectstack/plugin-security` is NOT in objectql's runtime
// closure (12 packages), so this direction is not the cycle turbo refuses. It is
// also the specifier this package's `vitest.config.ts` already aliases to SOURCE,
// so it adds no new artifact-resolved import.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
// The REAL shipped reconciler — not a re-implementation. A local copy would
// make this suite a test of the copy, which is exactly the failure mode the
// file exists to close.
import { syncAudienceBindingSuggestions } from './suggested-audience-bindings.js';
import { SysAudienceBindingSuggestion } from './objects/sys-audience-binding-suggestion.object.js';
// The other three tables the reconciler consults, as the REAL declarations —
// never hand-rolled stand-ins. With them registered the anchor lookup and the
// "is it already bound?" lookup resolve properly (to "anchor present, binding
// absent" — the genuine PENDING case), instead of throwing table-missing
// errors that `tryFind` swallows into `[]` and that reach the same verdict for
// the wrong reason.
import { SysPosition } from './objects/sys-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';

/**
 * #8577 — the INSTALL PATH of `sys_audience_binding_suggestion`, on a real
 * engine, through the real reconciler.
 *
 * ## Why the 409/201 oracle is the LESSER half of this object's story
 *
 * The rest of the #8323 class is about two tenants wanting the same *name*.
 * This object's key is `(package_id, permission_set_name, anchor)` and all
 * three come from the package's own manifest — **the same triple for every
 * tenant that installs the same package** — while the row is per-tenant by
 * construction (ADR-0090 D5/D9: produced when the declaration is observed,
 * resolved when a TENANT ADMIN confirms).
 *
 * So the question a driver-level "the second create now returns 201" assertion
 * does NOT answer is the one that matters: *does the second organization's
 * admin actually get prompted?* That is what this file measures, end to end:
 * two organizations install the same package; each must end up with its own
 * pending suggestion row.
 *
 * ## Why the failure was silent
 *
 * `syncAudienceBindingSuggestions` wraps its insert in a bare `catch` whose
 * comment reads "unique-index race with a concurrent sync — benign". Under the
 * pre-fix installation-wide index the UNIQUE violation raised for the SECOND
 * organization is indistinguishable from that benign race, so it was swallowed:
 * no throw, no warning, and `created` simply stayed 0. Section 1 asserts that
 * silence explicitly — it is the reason nobody noticed.
 *
 * ## The harness
 *
 * A real `ObjectQL` engine over a real better-sqlite3 `SqlDriver`, registering
 * the REAL shipped declaration (cloned only to flip `unique` back to the
 * pre-fix spelling for the BEFORE cases). The one hand-built part is the `ql`
 * facade: it threads ONE organization's execution context onto every call the
 * reconciler makes, which is what a runtime serving that tenant does, and it
 * supplies the installed-package manifest the reconciler reads through
 * `registry.getAllPackages()`.
 *
 * ⚠️ Section 3 records a measured LIMIT of that faithfulness, and it is the
 * finding this file exists to keep visible.
 */

/** The package both organizations install. */
const PACKAGE_MANIFEST = {
  id: 'com.acme.crm',
  permissions: [{ name: 'sales_readonly', isDefault: true }],
};

/** The two tenants of one installation. */
const ORGANIZATIONS = ['org_jia', 'org_yi'] as const;

const engines: ObjectQL[] = [];

afterEach(async () => {
  while (engines.length) {
    try {
      await engines.pop()?.destroy();
    } catch {
      /* noop */
    }
  }
});

/** The shipped declaration, or a clone respelled back to the pre-fix `true`. */
function declaration(scope: true | 'organization'): any {
  const decl: any = structuredClone(SysAudienceBindingSuggestion);
  decl.indexes[0].unique = scope;
  return decl;
}

async function boot(scope: true | 'organization'): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.security-objects',
    name: 'Security Objects',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [declaration(scope), SysPosition, SysPermissionSet, SysPositionPermissionSet],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  // Each organization has the `everyone` anchor seeded (bootstrapBuiltinRoles
  // does this before the reconciler ever runs) and holds the package's set,
  // but NO binding between them — which is exactly the state a package install
  // leaves behind and the state a `pending` suggestion describes.
  for (const org of ORGANIZATIONS) {
    await (engine as any).insert(
      'sys_position',
      { id: `pos_everyone_${org}`, name: 'everyone', label: 'Everyone' },
      { context: { isSystem: true, tenantId: org } },
    );
    await (engine as any).insert(
      'sys_permission_set',
      { id: `ps_${org}`, name: 'sales_readonly', label: 'Sales Readonly', package_id: PACKAGE_MANIFEST.id },
      { context: { isSystem: true, tenantId: org } },
    );
  }
  return engine;
}

/**
 * The engine as the runtime of ONE organization presents it: every call the
 * reconciler makes carries that organization's tenant context, and
 * `registry.getAllPackages()` answers with the installed manifest.
 *
 * `listItems` returns `[]` on purpose — this models a RUNTIME package install
 * (`POST /api/v1/packages`), where the declaration reaches the reconciler
 * through the registry rather than through boot-declared stack metadata.
 *
 * ⚠️ `update` and `delete` open with the producer's dispatch predicates. Both
 * verbs are seams the reconciler really uses — `update` on the
 * pending→confirmed-observed branch, `delete` on the prune branch — even though
 * this suite's fixtures (declaration present, binding absent) reach neither.
 * Forwarding to a real engine cannot make a seam LOOSER than that engine, but
 * the gate reads shape rather than provenance and the assertion costs nothing:
 * it pins that whatever this seam forwards is a call `ObjectQL` would accept.
 */
function runtimeOf(engine: ObjectQL, organizationId: string): any {
  const withOrg = (o: any = {}) => ({ ...o, context: { ...(o.context ?? {}), tenantId: organizationId } });
  return {
    find: (object: string, q: any = {}) => (engine as any).find(object, withOrg(q)),
    insert: (object: string, data: any, opt: any = {}) => (engine as any).insert(object, data, withOrg(opt)),
    update: (object: string, data: any, opt: any = {}) => {
      assertEngineUpdateDispatch(data, opt);
      return (engine as any).update(object, data, withOrg(opt));
    },
    delete: (object: string, opt: any = {}) => {
      assertEngineDeleteDispatch(opt);
      return (engine as any).delete(object, withOrg(opt));
    },
    registry: {
      listItems: () => [],
      getAllPackages: () => [{ enabled: true, manifest: PACKAGE_MANIFEST }],
    },
  };
}

/** Every stored row, read past tenancy — the ground truth, not a tenant's view. */
async function storedRows(engine: ObjectQL): Promise<Array<{ org: string | null; key: string; status: string }>> {
  const driver: any = (engine as any).getDriver('sys_audience_binding_suggestion');
  const rows: any[] = await driver.knex('sys_audience_binding_suggestion').select('*');
  return rows.map((r) => ({
    org: r.organization_id ?? null,
    key: `${r.package_id}/${r.permission_set_name}/${r.anchor}`,
    status: r.status,
  }));
}

/** What ONE organization's admin surface can see. */
async function visibleTo(engine: ObjectQL, organizationId: string): Promise<any[]> {
  return (engine as any).find('sys_audience_binding_suggestion', {
    context: { isSystem: true, tenantId: organizationId },
  });
}

/** Unique index names materialized on the table. */
async function uniqueIndexNames(engine: ObjectQL): Promise<string[]> {
  const driver: any = (engine as any).getDriver('sys_audience_binding_suggestion');
  const list: any[] = await driver.knex.raw('PRAGMA index_list(sys_audience_binding_suggestion)');
  return list.filter((i) => i.origin !== 'pk' && i.unique === 1).map((i) => i.name).sort();
}

const KEY = 'com.acme.crm/sales_readonly/everyone';

describe('#8577 — the package-install path of sys_audience_binding_suggestion', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. BEFORE — the dead end, measured through the real reconciler
  // ─────────────────────────────────────────────────────────────────────────

  describe('with the pre-fix installation-wide index', () => {
    it('the harness really carries the pre-fix index (harness guard)', async () => {
      // Without this the whole block could be exercising the FIXED schema and
      // every assertion below would read as a description of the defect while
      // measuring the fix. Named as a guard on purpose.
      const engine = await boot(true);
      expect(await uniqueIndexNames(engine)).toEqual(['uniq_sys_audience_binding_suggestion_79a05fef']);
    });

    it('the SECOND organization to install the package never gets its suggestion row', async () => {
      const engine = await boot(true);

      const first = await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_jia'));
      const second = await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_yi'));

      expect(first).toMatchObject({ created: 1 });
      // The measurement the card is about: not "an error", not "a warning" —
      // nothing at all happened for the second tenant.
      expect(second).toMatchObject({ created: 0, confirmedObserved: 0, pruned: 0 });

      expect(await storedRows(engine)).toEqual([
        { org: 'org_jia', key: KEY, status: 'pending' },
      ]);

      // …and the consequence in the terms an admin experiences it: org_yi's
      // suggestion surface is EMPTY, so its admin is never asked to bind the
      // package's default permission set, and its users never receive it.
      expect(await visibleTo(engine, 'org_yi')).toHaveLength(0);
    });

    it('and the reconciler reports NOTHING — no throw, no warning, only the first tenant is logged', async () => {
      // The reason nobody noticed: the reconciler cannot tell the UNIQUE
      // violation raised for a second TENANT from the benign concurrent-sync
      // race its `catch` was written for.
      //
      // Precisely: the only trace anywhere is the ENGINE's own driver-level
      // "Insert operation failed" line (visible in this suite's output on the
      // two pre-fix cases). Nothing above the driver — not the reconciler's
      // return value, not its logger, not the caller — ever learns that a
      // tenant went unprompted.
      const engine = await boot(true);
      const lines: Array<[string, string]> = [];
      const logger = {
        info: (m: string) => lines.push(['info', m]),
        warn: (m: string) => lines.push(['warn', m]),
      };

      await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_jia'), undefined, logger);
      await expect(
        syncAudienceBindingSuggestions(runtimeOf(engine, 'org_yi'), undefined, logger),
      ).resolves.toMatchObject({ created: 0 });

      expect(lines.filter(([level]) => level === 'warn')).toHaveLength(0);
      // Exactly one reconciliation was reported — org_jia's. The second
      // organization's produced no line of any kind, because from the
      // reconciler's point of view nothing needed doing.
      expect(lines).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. AFTER — each organization is prompted for its own install
  // ─────────────────────────────────────────────────────────────────────────

  describe('with the organization-scoped index', () => {
    it('the harness carries the REPLACEMENT index (harness guard)', async () => {
      const engine = await boot('organization');
      expect(await uniqueIndexNames(engine)).toEqual(['uniq_sys_audience_binding_suggestion_a736dc5a']);
    });

    it('two organizations installing the same package EACH get their own pending row', async () => {
      const engine = await boot('organization');

      const first = await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_jia'));
      const second = await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_yi'));

      expect(first).toMatchObject({ created: 1 });
      expect(second).toMatchObject({ created: 1 });

      expect((await storedRows(engine)).sort((a, b) => String(a.org).localeCompare(String(b.org)))).toEqual([
        { org: 'org_jia', key: KEY, status: 'pending' },
        { org: 'org_yi', key: KEY, status: 'pending' },
      ]);
    });

    it('…and each organization SEES exactly its own — the prompt actually reaches the admin', async () => {
      // The end the card cares about, stated the way an admin experiences it.
      const engine = await boot('organization');
      await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_jia'));
      await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_yi'));

      for (const org of ['org_jia', 'org_yi']) {
        const rows = await visibleTo(engine, org);
        expect(rows, org).toHaveLength(1);
        expect(rows[0].organization_id, org).toBe(org);
        expect(rows[0].status, org).toBe('pending');
      }
    });

    it('ANTI-VACUITY: the reconciler is still idempotent WITHIN an organization', async () => {
      // ⛔ The failure this guards against is a "fix" that removed uniqueness
      // instead of scoping it — strictly worse than the defect, and
      // indistinguishable from the real fix by the "each org gets a row"
      // assertion alone. Re-running a tenant's sync must add nothing.
      const engine = await boot('organization');

      await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_jia'));
      const again = await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_jia'));
      const third = await syncAudienceBindingSuggestions(runtimeOf(engine, 'org_jia'));

      expect(again).toMatchObject({ created: 0, confirmedObserved: 0, pruned: 0 });
      expect(third).toMatchObject({ created: 0 });
      expect(await storedRows(engine)).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. The remaining half — a MEASURED limit of this fix, kept visible
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * ⚠️ Read this before concluding the install path is whole.
   *
   * Everything above threads a tenant context onto the reconciler's calls.
   * The SHIPPED call sites do not: `suggested-audience-bindings.ts` writes with
   * a module-level `SYSTEM_CTX = { isSystem: true }` that carries no tenant, and
   * `security-plugin.ts` invokes it at boot and after a package-door publish
   * with the bare engine. Measured on this engine:
   *
   *   - an insert under `{ isSystem: true }` stores `organization_id` NULL;
   *   - a read under `{ isSystem: true }` sees every organization's rows;
   *   - a read under `{ isSystem: true, tenantId: X }` sees X's rows AND the
   *     NULL-organization rows (the driver expands the tenant predicate to
   *     `organization_id = :tenant OR organization_id IS NULL`).
   *
   * So on the shipped path the reconciler writes ONE organization-less row that
   * every tenant reads, and the second run finds it and skips — the same dead
   * end as the index, reached by a different road, and NOT repaired by
   * respelling the index. The index fix is necessary (without it even a
   * correctly tenant-scoped write is refused) and it is what this card was
   * ruled to deliver; the reconciler's tenant blindness is filed as **#8617**,
   * which also carries the measurements above and the tenancy question they
   * raise about this object.
   *
   * The two assertions below RECORD today's behaviour rather than endorse it.
   * #8617's fix must DELETE them, not update them — if they still pass
   * afterwards, that fix did not work.
   */
  describe('the shipped SYSTEM_CTX call path is tenant-blind (recorded, not endorsed)', () => {
    /**
     * The reconciler wired exactly as `security-plugin.ts` wires it — the bare
     * engine, no tenant threaded. Write verbs route through the producer's
     * dispatch predicates for the same reason as `runtimeOf` above.
     */
    const asShipped = (engine: ObjectQL): any => ({
      find: (object: string, q: any = {}) => (engine as any).find(object, q),
      insert: (object: string, data: any, opt: any = {}) => (engine as any).insert(object, data, opt),
      update: (object: string, data: any, opt: any = {}) => {
        assertEngineUpdateDispatch(data, opt);
        return (engine as any).update(object, data, opt);
      },
      delete: (object: string, opt: any = {}) => {
        assertEngineDeleteDispatch(opt);
        return (engine as any).delete(object, opt);
      },
      registry: {
        listItems: () => [],
        getAllPackages: () => [{ enabled: true, manifest: PACKAGE_MANIFEST }],
      },
    });

    it('writes ONE organization-less row, and the organization-scoped index does not change that', async () => {
      const engine = await boot('organization');

      const first = await syncAudienceBindingSuggestions(asShipped(engine));
      const second = await syncAudienceBindingSuggestions(asShipped(engine));

      expect(first).toMatchObject({ created: 1 });
      expect(second).toMatchObject({ created: 0 });
      expect(await storedRows(engine)).toEqual([{ org: null, key: KEY, status: 'pending' }]);
    });

    it('every tenant reads that same organization-less row, so only one decision exists', async () => {
      const engine = await boot('organization');
      await syncAudienceBindingSuggestions(asShipped(engine));

      for (const org of ['org_jia', 'org_yi']) {
        const rows = await visibleTo(engine, org);
        expect(rows, org).toHaveLength(1);
        expect(rows[0].organization_id ?? null, org).toBeNull();
      }
    });
  });
});
