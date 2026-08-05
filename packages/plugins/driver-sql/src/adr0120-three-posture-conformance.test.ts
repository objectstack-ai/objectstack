// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqlDriver, classifyIndexKeyPart, parseIndexDdl } from '../src/index.js';

/**
 * ADR-0120 §Acceptance tests — posture portability (S13/S14).
 *
 * ## The claim under test
 *
 * A metadata app is authored **once** and must run unmodified under every
 * tenancy posture — `single | group | isolated` (ADR-0105 D1) — and under
 * database-per-customer deployment. The vocabulary makes that possible by
 * naming **business boundaries**, never postures: the author says
 * `'organization'` (one holder per organization) or `'global'` (one holder
 * across the whole installation), and the driver materializes the same physical
 * shape everywhere. The ADR states this as an invariant with teeth:
 *
 * > **no index shape reads the posture, so a posture change has zero automatic
 * > schema consequences.**
 *
 * That is what this suite pins, and it is why the suite is written at the
 * DRIVER level rather than as three kernel boots: the driver is the only layer
 * that materializes a unique constraint, so if the posture leaks into a shape
 * at all, it leaks here. Three full kernel boots would exercise the same
 * `initObjects` call through 100× the machinery and prove strictly less about
 * the constraint, because a kernel boot cannot insert the violating pair.
 *
 * Each posture therefore boots the SAME fixture app against a fresh in-memory
 * database with the environment a deployment of that posture really carries
 * (`OS_TENANCY_POSTURE` **and** the `OS_MULTI_ORG_ENABLED` it reconciles with —
 * the driver reads the latter for its tenant-audit warning, so setting only the
 * former would leave half the posture unrepresented). Then, per posture:
 *
 *  1. every S-row's enforcement is asserted with a REAL violating insert, and
 *  2. the materialized key parts are captured, so the three postures can be
 *     compared byte-for-byte against each other.
 *
 * Plus one smoke assertion for transitions (the ADR asks for exactly one, and
 * explicitly no transition matrix): a database built under `single`, re-read
 * under `isolated`, reports **zero drift ops**.
 *
 * ## Reading a green run honestly
 *
 * Assertion (2) is the load-bearing one and it is a SAMENESS assertion, which
 * is the kind that can pass by producing nothing. So the shapes are also
 * asserted against their expected key parts positively — a run where
 * `initObjects` silently created no unique index at all would satisfy "all
 * three postures agree" and fail these.
 */

/** The postures, with the environment a real deployment of each carries. */
const POSTURES = [
  { posture: 'single', multiOrg: undefined },
  { posture: 'group', multiOrg: 'true' },
  { posture: 'isolated', multiOrg: 'true' },
] as const;

/**
 * ONE fixture app, covering the ADR's business-requirement matrix rows that a
 * unique constraint can be observed at: authored once, deployed under all three
 * postures, never edited between them.
 */
const FIXTURE_APP = [
  {
    // S1 — per-organization unique field. Two organizations may each hold
    // `a@b.com`; a duplicate WITHIN one may not. S8's mixed population rides
    // along: NULL-organization rows form one platform bucket (D3).
    name: 'crm_contact',
    fields: {
      organization_id: { type: 'string' },
      email: { type: 'string', unique: true },
    },
  },
  {
    // S2 — platform-wide unique field. A device identity is one holder across
    // the installation, in every posture.
    name: 'crm_device',
    fields: {
      organization_id: { type: 'string' },
      serial: { type: 'string', unique: 'global' },
    },
  },
  {
    // S3 — per-organization COMPOSITE, in the new spelling. The author states
    // the boundary; the driver supplies the organization key part.
    name: 'crm_case',
    fields: {
      organization_id: { type: 'string' },
      department: { type: 'string' },
      code: { type: 'string' },
    },
    indexes: [{ fields: ['department', 'code'], unique: 'organization' }],
  },
  {
    // S4/S5 — platform-wide composite: an engine-style dedup key, verbatim.
    // These are the constraints the ADR's rejected alternative would have
    // silently converted into NULL-void composites.
    name: 'crm_delivery',
    fields: {
      organization_id: { type: 'string' },
      source: { type: 'string' },
      dedup_key: { type: 'string' },
    },
    indexes: [{ fields: ['source', 'dedup_key'], unique: 'global' }],
  },
  {
    // S6 — the legacy hand-written organization composite, left in the old
    // spelling on purpose: it must keep its exact physical shape in every
    // posture (zero forced drift). Lint D5c nudges toward the respelling; the
    // driver forces nothing.
    name: 'crm_team',
    fields: {
      organization_id: { type: 'string' },
      name: { type: 'string' },
    },
    indexes: [{ fields: ['name', 'organization_id'], unique: true }],
  },
  {
    // S9 — autonumber paired with a per-organization unique. Every organization
    // counts from 1, so the constraint must be per-organization by construction
    // or the second organization's PROD-00001 is rejected by an index it cannot
    // see (the #3696 existence oracle).
    name: 'crm_product',
    fields: {
      organization_id: { type: 'string' },
      code: { type: 'autonumber', format: 'PROD-{00000}', unique: true },
    },
  },
  {
    // S11 — a tenancy-less object: `'organization'` degrades to the listed
    // columns alone, exactly as field-level `true` already does.
    name: 'crm_registry',
    tenancy: { enabled: false },
    fields: { slug: { type: 'string' } },
    indexes: [{ fields: ['slug'], unique: 'organization' }],
  },
  {
    // S12 — non-unique indexes are untouched by this ADR.
    name: 'crm_event',
    fields: {
      organization_id: { type: 'string' },
      status: { type: 'string' },
    },
    indexes: [{ fields: ['status'], unique: false }],
  },
] as const;

/**
 * The expected unique key parts, per table — the SAME map for every posture.
 * `COALESCE(col)` is the literal-agnostic reading of the NULL-safe organization
 * key part, matching the identity the drift differ compares on.
 */
const EXPECTED_UNIQUE_KEY_PARTS: Record<string, Record<string, string[]>> = {
  crm_contact: { uniq_crm_contact_organization_id_email: ['COALESCE(organization_id)', 'email'] },
  crm_device: { uniq_crm_device_serial: ['serial'] },
  // Note the index NAME: the deterministic name is derived from the RESOLVED
  // columns, so a declared `'organization'` index carries the organization
  // column in its name even though the author never listed it. That is the
  // differ's identity too, which is why declaring and detecting cannot drift.
  crm_case: {
    uniq_crm_case_organization_id_department_code: ['COALESCE(organization_id)', 'department', 'code'],
  },
  crm_delivery: { uniq_crm_delivery_source_dedup_key: ['source', 'dedup_key'] },
  crm_team: { uniq_crm_team_name_organization_id: ['name', 'organization_id'] },
  crm_product: { uniq_crm_product_organization_id_code: ['COALESCE(organization_id)', 'code'] },
  crm_registry: { uniq_crm_registry_slug: ['slug'] },
};

const REJECTED = /UNIQUE constraint failed|duplicate key value/;

describe('ADR-0120 — one app package, three tenancy postures (S13/S14 acceptance)', () => {
  let driver: SqlDriver;
  let savedPosture: string | undefined;
  let savedMultiOrg: string | undefined;
  let tmpDbDir: string | undefined;

  beforeEach(() => {
    savedPosture = process.env.OS_TENANCY_POSTURE;
    savedMultiOrg = process.env.OS_MULTI_ORG_ENABLED;
  });

  afterEach(async () => {
    await driver?.disconnect();
    if (tmpDbDir) {
      rmSync(tmpDbDir, { recursive: true, force: true });
      tmpDbDir = undefined;
    }
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
    if (savedMultiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = savedMultiOrg;
  });

  const makeDriver = (opts: any = {}) =>
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });

  const applyPosture = (posture: string, multiOrg: string | undefined) => {
    process.env.OS_TENANCY_POSTURE = posture;
    if (multiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = multiOrg;
  };

  /** Unique index name → canonical key parts, literal elided. */
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
        const info: any = await k.raw(`PRAGMA index_info(${idx.name})`);
        out[idx.name] = info.map((c: any) => c.name);
      }
    }
    return out;
  }

  /** Every table's unique shape, for cross-posture comparison. */
  async function shapeSnapshot(): Promise<Record<string, Record<string, string[]>>> {
    const snap: Record<string, Record<string, string[]>> = {};
    for (const table of Object.keys(EXPECTED_UNIQUE_KEY_PARTS)) {
      snap[table] = await uniqueKeyParts(table);
    }
    return snap;
  }

  const shapesByPosture: Record<string, Record<string, Record<string, string[]>>> = {};

  for (const { posture, multiOrg } of POSTURES) {
    describe(`posture: ${posture}`, () => {
      beforeEach(async () => {
        applyPosture(posture, multiOrg);
        driver = makeDriver();
        await driver.initObjects(FIXTURE_APP as any);
      });

      it('materializes exactly the declared boundaries — no posture in any shape', async () => {
        const snap = await shapeSnapshot();
        shapesByPosture[posture] = snap;
        // Positive assertion first: a run that created NO unique index would
        // otherwise satisfy the cross-posture sameness check below vacuously.
        for (const [table, expected] of Object.entries(EXPECTED_UNIQUE_KEY_PARTS)) {
          expect({ [table]: snap[table] }).toEqual({ [table]: expected });
        }
      });

      it('S1 — a per-organization unique field: shared across organizations, enforced within one', async () => {
        await driver.create('crm_contact', { organization_id: 'org_a', email: 'a@b.com' });
        // Two organizations may each hold the value…
        await expect(driver.create('crm_contact', { organization_id: 'org_b', email: 'a@b.com' }))
          .resolves.toBeTruthy();
        // …and a duplicate within one may not.
        await expect(driver.create('crm_contact', { organization_id: 'org_a', email: 'a@b.com' }))
          .rejects.toThrow(REJECTED);
      });

      it('S7/S8 — the NULL-organization bucket is a real bucket, in every posture', async () => {
        // THE #5030 headline, and the reason `'organization'` could ship at all:
        // before D3 this pair inserted twice on a single-organization stack
        // (SQL UNIQUE is NULL-distinct), so every field-level unique was a
        // silent no-op there. It must now be enforced under `single` exactly as
        // under `isolated` — the posture is not what makes a constraint real.
        await driver.create('crm_contact', { email: 'platform@b.com' });
        await expect(driver.create('crm_contact', { email: 'platform@b.com' }))
          .rejects.toThrow(REJECTED);
        // …while an organization-owned row with the same value still fits (S8).
        await expect(driver.create('crm_contact', { organization_id: 'org_a', email: 'platform@b.com' }))
          .resolves.toBeTruthy();
      });

      it('S2 — a platform-wide unique field crosses organizations, in every posture', async () => {
        await driver.create('crm_device', { organization_id: 'org_a', serial: 'SN-1' });
        await expect(driver.create('crm_device', { organization_id: 'org_b', serial: 'SN-1' }))
          .rejects.toThrow(REJECTED);
      });

      it("S3 — a declared `unique: 'organization'` composite is per organization", async () => {
        await driver.create('crm_case', { organization_id: 'org_a', department: 'ops', code: 'C1' });
        await expect(driver.create('crm_case', { organization_id: 'org_b', department: 'ops', code: 'C1' }))
          .resolves.toBeTruthy();
        await expect(driver.create('crm_case', { organization_id: 'org_a', department: 'ops', code: 'C1' }))
          .rejects.toThrow(REJECTED);
        // …and the NULL bucket is constrained too (D3 reaches declared indexes).
        await driver.create('crm_case', { department: 'ops', code: 'C9' });
        await expect(driver.create('crm_case', { department: 'ops', code: 'C9' }))
          .rejects.toThrow(REJECTED);
      });

      it('S4/S5 — a platform-wide dedup key stays platform-wide, NULL organization included', async () => {
        // The nine engine idempotency keys live or die on this row: they are
        // written by sudo with a NULL organization, so a composite would have
        // enforced nothing on exactly the rows that matter.
        await driver.create('crm_delivery', { source: 'smtp', dedup_key: 'K1' });
        await expect(driver.create('crm_delivery', { source: 'smtp', dedup_key: 'K1' }))
          .rejects.toThrow(REJECTED);
        await expect(driver.create('crm_delivery', { organization_id: 'org_a', source: 'smtp', dedup_key: 'K1' }))
          .rejects.toThrow(REJECTED);
      });

      it('S6 — the legacy hand-written composite keeps its exact shape, unmigrated', async () => {
        // Zero forced drift: the old spelling is untouched until the author
        // opts in. Its NULL hole therefore SURVIVES here, and that is the
        // correct, documented outcome — not a bug this suite should paper over.
        await driver.create('crm_team', { organization_id: 'org_a', name: 'Core' });
        await expect(driver.create('crm_team', { organization_id: 'org_a', name: 'Core' }))
          .rejects.toThrow(REJECTED);
        await expect(driver.create('crm_team', { organization_id: 'org_b', name: 'Core' }))
          .resolves.toBeTruthy();
        // The un-closed NULL hole, pinned as the honest status quo (D5c nudges
        // toward the respelling that closes it; nothing forces it).
        await driver.create('crm_team', { name: 'Platform' });
        await expect(driver.create('crm_team', { name: 'Platform' })).resolves.toBeTruthy();
      });

      it('S9 — autonumber + per-organization unique: every organization counts from 1', async () => {
        const a = await driver.create('crm_product', { organization_id: 'org_a' });
        const b = await driver.create('crm_product', { organization_id: 'org_b' });
        expect(a.code).toBe('PROD-00001');
        expect(b.code).toBe('PROD-00001');
      });

      it("S11 — `'organization'` on a tenancy-less object degrades to the listed columns", async () => {
        await driver.create('crm_registry', { slug: 'alpha' });
        await expect(driver.create('crm_registry', { slug: 'alpha' })).rejects.toThrow(REJECTED);
      });

      it('S12 — a non-unique index constrains nothing', async () => {
        await driver.create('crm_event', { organization_id: 'org_a', status: 'open' });
        await expect(driver.create('crm_event', { organization_id: 'org_a', status: 'open' }))
          .resolves.toBeTruthy();
      });

      it('the app is converged on arrival — zero drift right after registration', async () => {
        expect(await driver.detectManagedDrift()).toEqual([]);
      });
    });
  }

  describe('posture portability', () => {
    it('all three postures materialize BYTE-IDENTICAL unique shapes', async () => {
      // Captured independently per posture above; compared here. This is the
      // ADR's invariant stated as an equality — "no index shape reads the
      // posture" is false the moment any two of these differ.
      const captured: Record<string, Record<string, Record<string, string[]>>> = {};
      for (const { posture, multiOrg } of POSTURES) {
        applyPosture(posture, multiOrg);
        await driver?.disconnect();
        driver = makeDriver();
        await driver.initObjects(FIXTURE_APP as any);
        captured[posture] = await shapeSnapshot();
      }
      expect(captured.group).toEqual(captured.single);
      expect(captured.isolated).toEqual(captured.single);
      // …and they are the DECLARED shapes, not three identical empties.
      expect(captured.single).toEqual(EXPECTED_UNIQUE_KEY_PARTS);
    });

    it('a posture flip by itself emits ZERO drift ops (the transition smoke)', async () => {
      // The ADR asks for exactly one transition assertion and explicitly no
      // transition matrix: because no shape reads the posture, a re-platforming
      // event has no automatic schema consequence. Build the database under
      // `single`, then read it back under `isolated` on a driver that never saw
      // the first — a real restart after a posture change.
      applyPosture('single', undefined);
      // A real file, not `:memory:`: the point is that a SECOND driver — a
      // restart after the posture change — opens the database the first one
      // built. (An on-disk temp file, not a `file:…?cache=shared` URI:
      // better-sqlite3 takes the filename literally and would create a file by
      // that name in the package directory.)
      tmpDbDir = mkdtempSync(join(tmpdir(), 'adr0120-flip-'));
      const shared = join(tmpDbDir, 'posture-flip.sqlite');
      driver = makeDriver({ connection: { filename: shared } });
      await driver.initObjects(FIXTURE_APP as any);
      expect(await driver.detectManagedDrift()).toEqual([]);
      const before = await shapeSnapshot();

      applyPosture('isolated', 'true');
      const flipped = makeDriver({ connection: { filename: shared } });
      try {
        await flipped.initObjects(FIXTURE_APP as any);
        const drift = await flipped.detectManagedDrift();
        expect(drift).toEqual([]);
        // The physical shapes the flipped runtime sees are the ones the
        // `single` boot created — nothing was rebuilt behind anyone's back.
        const swap = driver;
        driver = flipped;
        expect(await shapeSnapshot()).toEqual(before);
        driver = swap;
      } finally {
        await flipped.disconnect();
      }
    });
  });
});
