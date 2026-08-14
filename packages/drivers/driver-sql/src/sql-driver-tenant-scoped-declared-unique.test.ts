// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver, classifyIndexKeyPart, parseIndexDdl, legacyUniqueReplacements } from '../src/index.js';

/**
 * #8554 — the FOURTH act of the #8323 class: five more tenant-scoped objects
 * whose declared unique indexes were installation-wide.
 *
 * ## What was measured here, live, before the fix — per object
 *
 * The card was filed from an executed lint sweep but was explicit that no live
 * probe had been run against any of the five, and the maintainer ruling of
 * 2026-08-13 makes the probe the required first step. It reproduced on all five,
 * exactly as predicted, driving the REAL shipped declarations through this
 * driver on `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * sys_permission_set          uniq_sys_permission_set_name            (name)
 * sys_sharing_rule            uniq_sys_sharing_rule_name              (name)
 * sys_webhook                 uniq_sys_webhook_name                   (name)
 * sys_email_template          uniq_sys_email_template_name_locale     (name, locale)
 * sys_notification_preference uniq_sys_notification_preference_…      (user_id, topic, channel)
 *
 * org_jia POST the key   → 201
 * org_yi  POST the SAME  → 409 UNIQUE_VIOLATION
 * org_yi  POST an unused → 201                ← the control that makes it an ORACLE
 * org_yi  GET  the key   → total 0            ← refused by a row it cannot see
 * ```
 *
 * A per-value refusal on a row the caller cannot read is a cross-tenant
 * existence oracle. It is also a plain dead end: two organizations could not
 * both name a permission set `sales_readonly`, and — the `sys_user_preference`
 * symptom, inherited by its near-twin `sys_notification_preference` — a user in
 * two organizations could not hold independent per-topic toggles.
 *
 * ## Why the declarations were global
 *
 * The deliberate divergence #8323 documents: a DECLARED index's bare
 * `unique: true` is the positional spelling of `'global'` and takes the listed
 * columns VERBATIM, while FIELD-level `unique: true` has meant per-organization
 * since #3696. `packages/lint/src/data-model-rules.ts` calls it "the #4986 trap".
 *
 * ⚠️ `managedBy` is NOT the discriminator. `sys_notification_preference` is
 * `managedBy: 'system-data'`, and so is the already-ruled `sys_user_preference`.
 * The ruling's phrase is ADMIN-AUTHORED CONTENT — the provenance of the rows,
 * not the management mode of the object.
 *
 * ## Why this suite is at the DRIVER level
 *
 * The driver is the only layer that materializes a unique constraint and the
 * only layer that can insert the violating row. `rest-server.ts` maps any error
 * satisfying `isUniqueViolationError` to `409 UNIQUE_VIOLATION` and a successful
 * create to `201`, so each case asserts the ENVELOPE the API would put on the
 * wire — never a bare `.toThrow()`, which a driver throwing a plain `Error`
 * would satisfy while REST answered 500.
 *
 * ## The half a fresh-database suite cannot see
 *
 * #8323's most expensive finding, re-measured for this card in Ablation B:
 * respelling changes the index's generated NAME, so on a DEPLOYED database drift
 * reads as two findings — composite missing (safe, auto-applied) and old global
 * index orphaned (destructive, opt-in) — and an operator applying only the safe
 * half keeps the defect while the plan reads as applied. Section 3 is therefore
 * the load-bearing part of this file: it builds installations that ALREADY HAVE
 * the old index and real rows, then migrates them.
 */

/** The wire shape a duplicate insert must produce, per `rest-server.ts`. */
const CONFLICT_ENVELOPE = { status: 409, code: 'UNIQUE_VIOLATION' } as const;

async function createAsApi(
  driver: SqlDriver,
  object: string,
  record: Record<string, unknown>,
): Promise<{ status: number; code?: string; raw?: unknown }> {
  try {
    await driver.create(object, record as any);
    return { status: 201 };
  } catch (error) {
    if (isUniqueViolationError(error)) return { status: 409, code: 'UNIQUE_VIOLATION', raw: error };
    return { status: 500, code: 'INTERNAL_ERROR', raw: error };
  }
}

/**
 * One object under test.
 *
 * ⚠️ `preIndexes` / `fixedIndexes` are hand-copied from the shipped
 * declarations, keeping the package boundary (the shape #8461 and #8556 used —
 * `driver-sql` must not depend on five plugin packages). The copy is guarded in
 * ONE direction only: each package carries a pin asserting its real
 * `Xxx.indexes` against its own inline literal, so a change to a SHIPPED
 * declaration that is not mirrored here goes red over there. The reverse is
 * unguarded — edit a fixture below without touching its declaration and nothing
 * compares them. Treat these as hand-maintained and change them only together
 * with the declaration.
 *
 * The `unique: false` on the non-unique entries is not decoration:
 * `ObjectSchema.create` normalizes an authored `{ fields: ['active'] }` into
 * that shape, so this is what a driver is actually handed at registration.
 */
interface Subject {
  table: string;
  /** Physical columns the constraint and the rows need. */
  fields: Record<string, { type: string }>;
  preIndexes: Array<Record<string, unknown>>;
  fixedIndexes: Array<Record<string, unknown>>;
  /** The declared unique index's listed columns, in key order. */
  keyColumns: string[];
  /** The colliding value, column by column. */
  key: Record<string, string>;
  /** Differs from `key` in its FIRST column — the 201 control. */
  control: Record<string, string>;
  /** Differs from `key` in a NON-leading column. Composites only. */
  trailingControl?: Record<string, string>;
  /**
   * A third distinct value, used for the organization-LESS (platform/seed) row.
   *
   * ⚠️ It must differ from `key`: the seeded database carries the PRE-FIX global
   * index, under which an organization-less row and an organization's row
   * sharing the key columns genuinely collide — that is the defect, not a
   * harness accident. Seeding both with `key` made `seedDeployed` throw a raw
   * UNIQUE violation and took 30 tests red at once.
   */
  platformKey: Record<string, string>;
  /** Other columns a row needs to be insertable. */
  filler?: Record<string, unknown>;
  /** Legacy (pre-fix) index name, as `buildIndexName` emits it. */
  legacyName: string;
  /** Replacement index name — hash-suffixed when the base passes 60 chars. */
  replacementName: string;
}

const s = { type: 'string' };
const b = { type: 'boolean' };

const SUBJECTS: Subject[] = [
  {
    table: 'sys_permission_set',
    fields: { id: s, organization_id: s, name: s, label: s, active: b, package_id: s },
    preIndexes: [
      { fields: ['name'], unique: true }, // ← the defect
      { fields: ['active'], unique: false },
      { fields: ['package_id'], unique: false },
    ],
    fixedIndexes: [
      { fields: ['name'], unique: 'organization' },
      { fields: ['active'], unique: false },
      { fields: ['package_id'], unique: false },
    ],
    keyColumns: ['name'],
    key: { name: 'sales_readonly' },
    control: { name: 'only_in_org_yi' },
    filler: { label: 'Sales Readonly' },
    platformKey: { name: 'platform_baseline' },
    legacyName: 'uniq_sys_permission_set_name',
    replacementName: 'uniq_sys_permission_set_organization_id_name',
  },
  {
    table: 'sys_sharing_rule',
    fields: { id: s, organization_id: s, name: s, label: s, object_name: s, active: b },
    preIndexes: [
      { fields: ['object_name', 'active'], unique: false },
      { fields: ['name'], unique: true },
      { fields: ['organization_id'], unique: false },
    ],
    fixedIndexes: [
      { fields: ['object_name', 'active'], unique: false },
      { fields: ['name'], unique: 'organization' },
      { fields: ['organization_id'], unique: false },
    ],
    keyColumns: ['name'],
    key: { name: 'share_west_region' },
    control: { name: 'only_in_org_yi' },
    filler: { label: 'Share West Region', object_name: 'account' },
    platformKey: { name: 'platform_baseline_rule' },
    legacyName: 'uniq_sys_sharing_rule_name',
    replacementName: 'uniq_sys_sharing_rule_organization_id_name',
  },
  {
    table: 'sys_webhook',
    fields: { id: s, organization_id: s, name: s, label: s, url: s, object_name: s, active: b },
    preIndexes: [
      { fields: ['name'], unique: true },
      { fields: ['object_name'], unique: false },
      { fields: ['active', 'object_name'], unique: false },
    ],
    fixedIndexes: [
      { fields: ['name'], unique: 'organization' },
      { fields: ['object_name'], unique: false },
      { fields: ['active', 'object_name'], unique: false },
    ],
    keyColumns: ['name'],
    key: { name: 'order_created_hook' },
    control: { name: 'only_in_org_yi' },
    filler: { label: 'Order Created', url: 'https://example.test/hook' },
    platformKey: { name: 'platform_baseline_hook' },
    legacyName: 'uniq_sys_webhook_name',
    replacementName: 'uniq_sys_webhook_organization_id_name',
  },
  {
    table: 'sys_email_template',
    fields: { id: s, organization_id: s, name: s, locale: s, label: s, subject: s, body_html: s, category: s, active: b },
    preIndexes: [
      { fields: ['name', 'locale'], unique: true },
      { fields: ['category'], unique: false },
      { fields: ['active'], unique: false },
    ],
    fixedIndexes: [
      { fields: ['name', 'locale'], unique: 'organization' },
      { fields: ['category'], unique: false },
      { fields: ['active'], unique: false },
    ],
    keyColumns: ['name', 'locale'],
    key: { name: 'welcome', locale: 'en-US' },
    control: { name: 'only_in_org_yi', locale: 'en-US' },
    // Varies the TRAILING column only: 201 even before the fix, because the
    // installation-wide key was the composite rather than `name` alone. Without
    // this, "the key is (name, locale)" would rest on the fixture's spelling.
    trailingControl: { name: 'welcome', locale: 'zh-CN' },
    filler: { label: 'Welcome Email', category: 'auth', subject: 'Welcome', body_html: 'Hello', active: true },
    platformKey: { name: 'platform_welcome', locale: 'en-US' },
    legacyName: 'uniq_sys_email_template_name_locale',
    replacementName: 'uniq_sys_email_template_organization_id_name_locale',
  },
  {
    table: 'sys_notification_preference',
    fields: { id: s, organization_id: s, user_id: s, topic: s, channel: s, enabled: b },
    preIndexes: [
      { fields: ['user_id', 'topic', 'channel'], unique: true },
      { fields: ['topic'], unique: false },
    ],
    fixedIndexes: [
      { fields: ['user_id', 'topic', 'channel'], unique: 'organization' },
      { fields: ['topic'], unique: false },
    ],
    keyColumns: ['user_id', 'topic', 'channel'],
    key: { user_id: 'user_u1', topic: 'billing.invoice', channel: 'email' },
    control: { user_id: 'user_only_yi', topic: 'billing.invoice', channel: 'email' },
    trailingControl: { user_id: 'user_u1', topic: 'billing.invoice', channel: 'push' },
    filler: {},
    platformKey: { user_id: '*', topic: 'billing.invoice', channel: 'email' },
    legacyName: 'uniq_sys_notification_preference_user_id_topic_channel',
    // ⚠️ HASH-SUFFIXED, and this is the case the PM's A1 flagged as the one
    // where a single-column assumption would hide. The base name
    // `uniq_sys_notification_preference_organization_id_user_id_topic_channel`
    // is 70 characters, past `INDEX_NAME_MAX = 60`, so `buildIndexName`
    // truncates and appends a sha1 prefix. The 54-character LEGACY name is
    // emitted verbatim, so the two differ and the `legacyName === replacement.name`
    // guard correctly does not fire. Pinned literally rather than recomputed:
    // recomputing it with the same helper the code uses would assert nothing.
    replacementName: 'uniq_sys_notification_preference_a22d7d27',
  },
];

describe('#8554 — five tenant-scoped declared unique indexes become per-organization', () => {
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

  const app = (sub: Subject, which: 'pre' | 'fixed') => [
    { name: sub.table, fields: sub.fields, indexes: which === 'pre' ? sub.preIndexes : sub.fixedIndexes },
  ];

  beforeEach(() => {
    savedPosture = process.env.OS_TENANCY_POSTURE;
    savedMultiOrg = process.env.OS_MULTI_ORG_ENABLED;
    // The posture the probe was run on. ADR-0120's invariant is that no index
    // shape reads the posture — section 5 pins that — so this is context for the
    // reader, not an input the assertions depend on.
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

  const row = (sub: Subject, id: string, org: string | undefined, value: Record<string, string>) => ({
    id,
    ...(org ? { organization_id: org } : {}),
    ...(sub.filler ?? {}),
    ...value,
  });

  for (const sub of SUBJECTS) {
    describe(sub.table, () => {
      // ───────────────────────────────────────────────────────────────────
      // 1. Materialized shape — both spellings, kept side by side
      // ───────────────────────────────────────────────────────────────────

      it('the fixed declaration keys on the NULL-safe organization part', async () => {
        const d = makeDriver();
        await d.initObjects(app(sub, 'fixed') as any);

        expect(await uniqueKeyParts(sub.table)).toEqual({
          [sub.replacementName]: ['COALESCE(organization_id)', ...sub.keyColumns],
        });
      });

      it('the pre-fix declaration keyed on the bare business columns — installation-wide', async () => {
        // Kept permanently rather than measured once: this is the contrast that
        // makes every "AFTER" assertion below mean something.
        const d = makeDriver();
        await d.initObjects(app(sub, 'pre') as any);

        expect(await uniqueKeyParts(sub.table)).toEqual({ [sub.legacyName]: sub.keyColumns });
      });

      // ───────────────────────────────────────────────────────────────────
      // 2. The card's reproduction — the live probe the ruling required
      // ───────────────────────────────────────────────────────────────────

      it('BEFORE: a key held by another organization is refused — 409 on a row you cannot read', async () => {
        const d = makeDriver();
        await d.initObjects(app(sub, 'pre') as any);

        expect((await createAsApi(d, sub.table, row(sub, 'a', 'org_jia', sub.key))).status).toBe(201);
        expect(await createAsApi(d, sub.table, row(sub, 'b', 'org_yi', sub.key))).toMatchObject(
          CONFLICT_ENVELOPE,
        );

        // The control that makes the refusal an ORACLE rather than a blanket
        // rejection: an unused value from the same caller is accepted, so the
        // 409 is a per-value answer about another tenant's data.
        expect((await createAsApi(d, sub.table, row(sub, 'c', 'org_yi', sub.control))).status).toBe(201);

        // …and the other half of the oracle: the caller's own read of the
        // colliding key returns nothing. It is refused by a row it cannot see.
        const visible = (await d.find(sub.table, {})).filter(
          (r: any) =>
            r.organization_id === 'org_yi' && Object.entries(sub.key).every(([k, v]) => r[k] === v),
        );
        expect(visible).toHaveLength(0);
      });

      it('AFTER: the same cross-organization create is accepted — 409 flips to 201', async () => {
        const d = makeDriver();
        await d.initObjects(app(sub, 'fixed') as any);

        expect((await createAsApi(d, sub.table, row(sub, 'a', 'org_jia', sub.key))).status).toBe(201);
        expect((await createAsApi(d, sub.table, row(sub, 'b', 'org_yi', sub.key))).status).toBe(201);

        const held = (await d.find(sub.table, {})).filter((r: any) =>
          Object.entries(sub.key).every(([k, v]) => r[k] === v),
        );
        expect(held.map((r: any) => r.organization_id).sort()).toEqual(['org_jia', 'org_yi']);
      });

      it('AFTER (anti-vacuity): a SAME-organization duplicate is still refused', async () => {
        // If this ever goes green-by-acceptance the constraint was REMOVED, not
        // scoped — strictly worse than the defect being fixed, and
        // indistinguishable from the fix by the 409-flips-to-201 assertion alone.
        const d = makeDriver();
        await d.initObjects(app(sub, 'fixed') as any);

        expect((await createAsApi(d, sub.table, row(sub, 'a', 'org_jia', sub.key))).status).toBe(201);
        expect(await createAsApi(d, sub.table, row(sub, 'b', 'org_jia', sub.key))).toMatchObject(
          CONFLICT_ENVELOPE,
        );
        expect(await d.count(sub.table, {})).toBe(1);
      });

      it('AFTER: rows with no organization stay unique among THEMSELVES (ADR-0120 D3)', async () => {
        // Platform/seed rows carry no organization. A bare
        // `(organization_id, …)` composite would be NULL-DISTINCT under SQL, so
        // every seeded row could be duplicated at will; the NULL-safe key part
        // is what prevents that, and seed upsert-by-name relies on it.
        const d = makeDriver();
        await d.initObjects(app(sub, 'fixed') as any);

        expect((await createAsApi(d, sub.table, row(sub, 'seed1', undefined, sub.key))).status).toBe(201);
        expect(await createAsApi(d, sub.table, row(sub, 'seed2', undefined, sub.key))).toMatchObject(
          CONFLICT_ENVELOPE,
        );

        // A tenant may still hold its OWN row of the same key — the platform
        // bucket and the organization buckets are separate namespaces.
        expect((await createAsApi(d, sub.table, row(sub, 'own1', 'org_jia', sub.key))).status).toBe(201);
      });

      if (sub.trailingControl) {
        it('the key is the whole COMPOSITE — varying a trailing column was always accepted', async () => {
          // Guards the fixture's own claim about which columns the constraint
          // spans. Green BEFORE and AFTER by design: it describes behaviour this
          // card does not change, which is exactly what makes it a control. If
          // the key were silently narrowed to the leading column this goes red.
          const d = makeDriver();
          await d.initObjects(app(sub, 'pre') as any);

          expect((await createAsApi(d, sub.table, row(sub, 'a', 'org_jia', sub.key))).status).toBe(201);
          expect(
            (await createAsApi(d, sub.table, row(sub, 'b', 'org_yi', sub.trailingControl!))).status,
          ).toBe(201);
        });
      }

      // ───────────────────────────────────────────────────────────────────
      // 3. The deployed-installation half — the #8323 trap, per object
      // ───────────────────────────────────────────────────────────────────

      describe('migration on a database built before the respelling', () => {
        /**
         * An installation that ALREADY HAS the old global index and real rows —
         * i.e. every deployment in the field. A fresh-provision test cannot
         * reach any of the assertions in this block.
         */
        const seedDeployed = async (d: SqlDriver) => {
          await d.initObjects(app(sub, 'pre') as any);
          await d.create(sub.table, row(sub, 'r1', 'org_jia', sub.key) as any);
          await d.create(sub.table, row(sub, 'r2', 'org_jia', sub.control) as any);
          await d.create(sub.table, row(sub, 'r3', undefined, sub.platformKey) as any);
        };

        it('the seeded database really carries the pre-fix index, and the defect is live on it (harness guard)', async () => {
          // Without this the whole block could be exercising a fresh schema and
          // every assertion below would still pass. Named as a guard on purpose.
          const d = makeDriver();
          await seedDeployed(d);

          expect(await uniqueKeyParts(sub.table)).toEqual({ [sub.legacyName]: sub.keyColumns });
          expect(await d.count(sub.table, {})).toBe(3);
          expect(await createAsApi(d, sub.table, row(sub, 'x', 'org_yi', sub.key))).toMatchObject(
            CONFLICT_ENVELOPE,
          );
        });

        it('is planned as ONE pure relaxation, categorised safe — not a destructive orphan drop', async () => {
          const d = makeDriver();
          await seedDeployed(d);
          // The new metadata arrives (a deploy), same database.
          await d.initObjects(app(sub, 'fixed') as any);

          const drift = await d.detectManagedDrift();
          expect(drift.filter((e) => e.table === sub.table)).toHaveLength(1);
          const entry = drift.find(
            (e) => e.table === sub.table && e.op.type === 'replace_unique_index',
          );
          expect(entry, 'the respelling must be a replacement, not two unrelated findings').toBeDefined();
          expect(entry!.category).toBe('safe');
          expect(entry!.op).toMatchObject({
            dropIndexNames: [sub.legacyName],
            createIndexName: sub.replacementName,
            createColumns: ['organization_id', ...sub.keyColumns],
            nullSafeColumns: ['organization_id'],
          });

          // ⛔ The old index must NOT ALSO surface as an orphan. An orphan drop
          // is `destructive`, so an operator applying only the safe half would
          // keep the global index — keep the defect — while the plan read as
          // applied. That is the exact failure #8323 measured.
          expect(
            drift.filter(
              (e) => e.op.type === 'drop_index' && (e.op as any).indexName === sub.legacyName,
            ),
          ).toHaveLength(0);
        });

        it('applies WITHOUT --allow-destructive, keeps every row, and converges', async () => {
          const d = makeDriver();
          await seedDeployed(d);
          await d.initObjects(app(sub, 'fixed') as any);

          const drift = await d.detectManagedDrift();
          const { applied, skipped } = await d.applyMigrationEntries(drift, { allowDestructive: false });
          expect(applied.some((e) => e.op.type === 'replace_unique_index')).toBe(true);
          expect(skipped).toHaveLength(0);

          expect(await uniqueKeyParts(sub.table)).toEqual({
            [sub.replacementName]: ['COALESCE(organization_id)', ...sub.keyColumns],
          });
          expect(await d.count(sub.table, {})).toBe(3);

          // Re-running finds nothing: the plan is not a drop/create cycle.
          expect(await d.detectManagedDrift()).toHaveLength(0);
        });

        it('after applying, BOTH halves hold on the MIGRATED database', async () => {
          // The assertion the card is actually about: the fix reaches a deployed
          // installation, not merely a freshly provisioned one.
          const d = makeDriver();
          await seedDeployed(d);
          await d.initObjects(app(sub, 'fixed') as any);
          await d.applyMigrationEntries(await d.detectManagedDrift(), { allowDestructive: false });

          expect((await createAsApi(d, sub.table, row(sub, 'z1', 'org_yi', sub.key))).status).toBe(201);

          // The anti-vacuity arm, on the SAME migrated index.
          expect(await createAsApi(d, sub.table, row(sub, 'z2', 'org_jia', sub.key))).toMatchObject(
            CONFLICT_ENVELOPE,
          );

          // …and the organization-less bucket survived the migration intact:
          // the seeded platform row still blocks a duplicate of ITSELF.
          expect(await createAsApi(d, sub.table, row(sub, 'z3', undefined, sub.platformKey))).toMatchObject(
            CONFLICT_ENVELOPE,
          );
        });

        it('boot creates the replacement ADDITIVELY, so the defect is STILL LIVE until the plan runs', async () => {
          // `initObjects` is additive-only: it materializes the newly-declared
          // composite at boot and never drops anything. So a deployed
          // installation that has taken the new code but not run the plan is
          // still enumerable — deploying the respelling is not, by itself, the
          // fix. This is the sentence an operator needs, stated as an assertion.
          const d = makeDriver();
          await seedDeployed(d);
          await d.initObjects(app(sub, 'fixed') as any);

          expect(Object.keys(await uniqueKeyParts(sub.table)).sort()).toEqual(
            [sub.legacyName, sub.replacementName].sort(),
          );
          expect(await createAsApi(d, sub.table, row(sub, 'y', 'org_yi', sub.key))).toMatchObject(
            CONFLICT_ENVELOPE,
          );
        });

        it('DROP happens only once the replacement is confirmed present', async () => {
          // The safety argument in the direction that can actually go wrong: if
          // the replacement is not there, the legacy index must be left alone
          // rather than dropped into a gap with no uniqueness at all.
          const d = makeDriver();
          await seedDeployed(d);
          await d.initObjects(app(sub, 'fixed') as any);
          const drift = await d.detectManagedDrift();

          await (d as any).knex.raw(`DROP INDEX ${sub.replacementName}`);
          (d as any).syncDeclaredIndexes = async () => undefined;

          const { applied, skipped } = await d.applyMigrationEntries(drift, { allowDestructive: false });
          const isReplace = (e: { table: string; op: { type: string } }) =>
            e.table === sub.table && e.op.type === 'replace_unique_index';
          expect(applied.some(isReplace)).toBe(false);
          expect(skipped.some(isReplace)).toBe(true);

          // The pre-migration constraint is intact: never left with neither index.
          expect(Object.keys(await uniqueKeyParts(sub.table))).toEqual([sub.legacyName]);
        });
      });

      // ───────────────────────────────────────────────────────────────────
      // 4. The #8461 arm and its guards, exercised on THIS object (A1)
      // ───────────────────────────────────────────────────────────────────

      describe('the declared-index replacement arm', () => {
        const physicalColumns = () => new Set(Object.keys(sub.fields));

        it('proposes exactly one retirement, keyed on the listed columns', () => {
          const [entry, ...rest] = legacyUniqueReplacements({
            table: sub.table,
            fields: {},
            tenantField: 'organization_id',
            physicalColumns: physicalColumns(),
            declaredIndexes: sub.fixedIndexes,
          } as any);
          expect(rest).toHaveLength(0);
          expect(entry).toMatchObject({
            // ⚠️ `legacyColumns` is the whole listed key, not the leading
            // column. `column` is the LEADING one and is reporting only — the
            // two composites here are what make that distinction observable.
            legacyColumns: sub.keyColumns,
            legacyNames: [sub.legacyName],
            replacement: {
              name: sub.replacementName,
              columns: ['organization_id', ...sub.keyColumns],
              unique: true,
              nullSafeColumns: ['organization_id'],
            },
          });
        });

        it('claims nothing for an EXPLICITLY NAMED index — that transition is a recreate', () => {
          // #8461 guard 1. If this ever starts proposing a replacement it would
          // ask to drop the very index `recreate_index` is rebuilding.
          expect(
            legacyUniqueReplacements({
              table: sub.table,
              fields: {},
              tenantField: 'organization_id',
              physicalColumns: physicalColumns(),
              declaredIndexes: [{ name: 'uq_hand_named', fields: sub.keyColumns, unique: 'organization' }],
            } as any),
          ).toHaveLength(0);
        });

        it('claims nothing when the legacy name IS the replacement name (the S6 composite)', () => {
          // #8461 guard 2 — what protects sys_team / sys_business_unit /
          // sys_member, and the seven S6 objects the #8554 sweep re-triaged.
          expect(
            legacyUniqueReplacements({
              table: sub.table,
              fields: {},
              tenantField: 'organization_id',
              physicalColumns: physicalColumns(),
              declaredIndexes: [
                { fields: ['organization_id', ...sub.keyColumns], unique: 'organization' },
              ],
            } as any),
          ).toHaveLength(0);
        });

        it('claims nothing for the BARE spelling — an unrespelled declaration is untouched (#5082)', () => {
          expect(
            legacyUniqueReplacements({
              table: sub.table,
              fields: {},
              tenantField: 'organization_id',
              physicalColumns: physicalColumns(),
              declaredIndexes: [{ fields: sub.keyColumns, unique: true }],
            } as any),
          ).toHaveLength(0);
        });
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. ADR-0120: no index shape reads the posture
  // ─────────────────────────────────────────────────────────────────────────

  describe('postureIndependence', () => {
    it('materializes the same key parts under single / group / isolated, on all five', async () => {
      for (const sub of SUBJECTS) {
        for (const posture of ['single', 'group', 'isolated']) {
          process.env.OS_TENANCY_POSTURE = posture;
          const d = makeDriver();
          await d.initObjects(app(sub, 'fixed') as any);
          expect(await uniqueKeyParts(sub.table), `${sub.table} posture=${posture}`).toEqual({
            [sub.replacementName]: ['COALESCE(organization_id)', ...sub.keyColumns],
          });
          await d.disconnect();
          driver = undefined;
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. The index-name truncation boundary (A1's hidden case)
  // ─────────────────────────────────────────────────────────────────────────

  describe('the hash-suffixed replacement name', () => {
    /**
     * `sys_notification_preference` is the only one of the five whose
     * replacement name passes `INDEX_NAME_MAX = 60` and is therefore truncated
     * to `uniq_<table>` plus a sha1 prefix. It is worth its own assertions
     * because a name-based retirement is precisely where this would go wrong:
     * if the legacy name and the replacement name ever collapsed to the same
     * string, the `legacyName === replacement.name` guard would silently treat
     * the respelling as "nothing was superseded" and emit NO migration — the
     * declaration would change, a fresh database would look right, and every
     * deployed installation would keep the global index forever.
     */
    const sub = SUBJECTS.find((x) => x.table === 'sys_notification_preference')!;

    it('the legacy and replacement names are DIFFERENT, so the S6 guard does not swallow the retirement', () => {
      expect(sub.legacyName.length).toBeLessThanOrEqual(60);
      expect(sub.replacementName).not.toBe(sub.legacyName);
      expect(sub.replacementName).toMatch(/^uniq_sys_notification_preference_[0-9a-f]{8}$/);
      // The un-truncated form, for the reader: 70 characters.
      expect('uniq_sys_notification_preference_organization_id_user_id_topic_channel'.length).toBe(70);
    });

    it('the truncated name is what actually materializes, and the migration converges on it', async () => {
      const d = makeDriver();
      await d.initObjects(app(sub, 'pre') as any);
      await d.create(sub.table, row(sub, 'r1', 'org_jia', sub.key) as any);
      await d.initObjects(app(sub, 'fixed') as any);
      await d.applyMigrationEntries(await d.detectManagedDrift(), { allowDestructive: false });

      expect(Object.keys(await uniqueKeyParts(sub.table))).toEqual([sub.replacementName]);
      expect(await d.detectManagedDrift()).toHaveLength(0);
    });
  });
});
