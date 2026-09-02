// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14484 — the backfill half of "A: tenant-scoped, writer-repaired, backfilled".
//
// These pin the properties the maintainer ruling names, as behaviour rather
// than as prose:
//
//   1. DRY RUN FIRST — `{ dryRun: true }` (the default) writes nothing;
//   2. derived from the RECORD the grant is about, off the column its object
//      is walled by;
//   3. ⭐ ORPHANS (record gone) stay NULL, are COUNTED and LOGGED, and are
//      never deleted here — the #5103 boot sweep owns that invariant;
//   4. every other row that cannot be derived STAYS NULL and is REPORTED, by
//      reason — never guessed;
//   5. IDEMPOTENT — a second run over the repaired database plans nothing,
//      writes nothing, and re-reports the untouched residue;
//   6. ⭐ the CLIFF the card names is closed by the repair: under a strict
//      organization wall (the shape `computeTenantLayer0Filter` composes for
//      the `isolated` posture) a tenant-scoped read of the table returns the
//      same grants the bare read returns for that organization — before the
//      repair it returned NONE of the legacy rows.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import {
  SYS_RECORD_SHARE_BACKFILL_OBJECT,
  applySysRecordShareOrganizationBackfill,
  formatSysRecordShareOrganizationBackfillReport,
  planSysRecordShareOrganizationBackfill,
  runSysRecordShareOrganizationBackfill,
  type SysRecordShareBackfillEngine,
} from './backfill-sys-record-share-organizations.js';

// ---------------------------------------------------------------------------
// Fake engine — schemas + rows, with `find` honouring the two predicate shapes
// the sweep issues (`{ col: null }` and `{ id: { $in: [...] } }`) plus plain
// equality, and — for the cliff cases — a STRICT organization wall applied to
// every non-system read, the way Layer 0 AND-composes it in production.
// ---------------------------------------------------------------------------

interface FakeSchema {
  fields: Record<string, unknown>;
  tenancy?: { enabled?: boolean; tenantField?: string };
}

/**
 * ⛔ REFUSES what it does not implement, so the sweep cannot grow a predicate
 * shape nothing here evaluates (see the `sys_file` precedent's double for the
 * measured reason).
 */
function matchesWhere(record: Record<string, unknown>, where: any): boolean {
  if (!where) return true;
  for (const [field, condition] of Object.entries(where)) {
    if (field.startsWith('$')) {
      throw new Error(
        `fake engine: unsupported WHERE combinator '${field}' — this double implements only `
        + 'field equality, `{ field: null }` and `{ field: { $in: [...] } }`.',
      );
    }
    const value = record[field];
    if (condition === null) {
      if (value !== null && value !== undefined && value !== '') return false;
    } else if (condition && typeof condition === 'object') {
      const operators = Object.keys(condition as Record<string, unknown>);
      if (operators.length !== 1 || operators[0] !== '$in') {
        throw new Error(`fake engine: unsupported operator(s) [${operators.join(', ')}] on field '${field}'.`);
      }
      const accepted = (condition as { $in: unknown[] }).$in;
      if (!accepted.map(String).includes(String(value))) return false;
    } else if (String(value) !== String(condition)) {
      return false;
    }
  }
  return true;
}

function createFakeEngine(init: {
  schemas: Record<string, FakeSchema | undefined>;
  rows: Record<string, Array<Record<string, unknown>>>;
  failUpdateFor?: Set<string>;
  failFindFor?: Set<string>;
  /** When set, every NON-system read is walled to `context.tenantId` by strict equality. */
  strictWall?: boolean;
}) {
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  for (const [object, list] of Object.entries(init.rows)) rows[object] = list.map((r) => ({ ...r }));
  const updates: Array<{ object: string; data: Record<string, unknown>; context: unknown }> = [];

  const engine: SysRecordShareBackfillEngine & {
    _rows: (object: string) => Array<Record<string, unknown>>;
    _updates: typeof updates;
  } = {
    getSchema(object: string) {
      const schema = init.schemas[object];
      if (!schema) throw new Error(`unknown object '${object}'`);
      return schema;
    },
    async find(object: string, options?: any) {
      if (init.failFindFor?.has(object)) throw new Error(`simulated read failure on ${object}`);
      const table = rows[object];
      if (!table) throw new Error(`object '${object}' is not mounted on this install`);
      let out = table;
      const ctx = options?.context ?? {};
      if (init.strictWall && !ctx.isSystem) {
        // Layer 0's `isolated` arm: `{ organization_id: <active org> }`,
        // AND-composed over everything else — the strict equality that wins
        // over the driver's NULL-tolerant arm (`backfill-sys-file-organizations.ts`).
        const org = ctx.tenantId;
        out = out.filter((r) => r.organization_id === org);
      }
      out = out.filter((r) => matchesWhere(r, options?.where));
      if (options?.orderBy?.[0]?.field === 'id') {
        out = [...out].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      }
      const offset = typeof options?.offset === 'number' ? options.offset : 0;
      const limit = typeof options?.limit === 'number' ? options.limit : out.length;
      return out.slice(offset, offset + limit).map((r) => ({ ...r }));
    },
    async update(object: string, data: any, options?: any) {
      // The producer's own dispatch predicate, so this double can never accept
      // an update shape the real `ObjectQL.update` refuses.
      assertEngineUpdateDispatch(data, options);
      if (init.failUpdateFor?.has(String(data?.id))) {
        throw new Error(`simulated write refusal for ${data.id}`);
      }
      updates.push({ object, data: { ...data }, context: options?.context });
      const table = rows[object] ?? [];
      const row = table.find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    },
    _rows: (object: string) => (rows[object] ?? []).map((r) => ({ ...r })),
    _updates: updates,
  };
  return engine;
}

/** An org-scoped business object: the injected `organization_id` column. */
const orgScoped = (extra: Record<string, unknown> = {}): FakeSchema => ({
  fields: { id: {}, name: {}, owner_id: {}, organization_id: {}, ...extra },
});

const ORG_A = 'org_a';
const ORG_B = 'org_b';

const baseSchemas: Record<string, FakeSchema | undefined> = {
  sys_record_share: orgScoped({ object_name: {}, record_id: {}, recipient_id: {}, access_level: {}, source: {} }),
  crm_deal: orgScoped(),
  crm_case: orgScoped(),
  // ADR-0066: a platform-global object — no wall column at all.
  sys_setting: { fields: { id: {}, name: {}, organization_id: {} }, tenancy: { enabled: false } },
  // An object with no organization column injected.
  ext_note: { fields: { id: {}, body: {} } },
};

const grant = (id: string, object: string, record: string, extra: Record<string, unknown> = {}) => ({
  id, object_name: object, record_id: record, recipient_type: 'user', recipient_id: 'u_x',
  access_level: 'read', source: 'manual', organization_id: null, ...extra,
});

function seeded(extra: Partial<Parameters<typeof createFakeEngine>[0]> = {}) {
  return createFakeEngine({
    schemas: baseSchemas,
    rows: {
      crm_deal: [
        { id: 'deal_a', name: 'A', organization_id: ORG_A },
        { id: 'deal_b', name: 'B', organization_id: ORG_B },
        { id: 'deal_orgless', name: 'no org', organization_id: null },
      ],
      crm_case: [{ id: 'case_a', name: 'A case', organization_id: ORG_A }],
      sys_setting: [{ id: 'set_1', name: 'global', organization_id: ORG_A }],
      ext_note: [{ id: 'note_1', body: 'x' }],
      sys_record_share: [
        grant('shr_deal_a', 'crm_deal', 'deal_a'),
        grant('shr_deal_b', 'crm_deal', 'deal_b'),
        grant('shr_case_a', 'crm_case', 'case_a'),
        grant('shr_orphan', 'crm_deal', 'deal_gone'),          // ⭐ record gone
        grant('shr_orgless', 'crm_deal', 'deal_orgless'),      // record exists, no org
        grant('shr_setting', 'sys_setting', 'set_1'),          // object opted out of tenancy
        grant('shr_note', 'ext_note', 'note_1'),               // object with no org column
        grant('shr_unknown', 'app_gone', 'r1'),                // object with no schema
        grant('shr_unaddressable', 'crm_deal', ''),            // no record id
        grant('shr_already', 'crm_deal', 'deal_a', { organization_id: ORG_A }), // already stamped: never scanned
      ],
    },
    ...extra,
  });
}

const orgOf = (engine: ReturnType<typeof seeded>, id: string) =>
  engine._rows(SYS_RECORD_SHARE_BACKFILL_OBJECT).find((r) => r.id === id)?.organization_id ?? null;

describe('[#14484] sys_record_share organization backfill — plan (dry run)', () => {
  it('the default is a DRY RUN: it names every row it would write and writes none of them', async () => {
    const engine = seeded();
    const report = await runSysRecordShareOrganizationBackfill(engine);
    expect(report.dryRun).toBe(true);
    expect(report.organizationField).toBe('organization_id');
    expect(report.scanned).toBe(9);          // `shr_already` is already stamped and never matches
    expect(report.planned).toBe(3);
    expect(report.written).toBe(0);
    expect(engine._updates).toHaveLength(0);
    // In scan order — by id, so the pages partition the population.
    expect(report.rows.map((r) => [r.id, r.organization, r.subject.object, r.subject.id])).toEqual([
      ['shr_case_a', ORG_A, 'crm_case', 'case_a'],
      ['shr_deal_a', ORG_A, 'crm_deal', 'deal_a'],
      ['shr_deal_b', ORG_B, 'crm_deal', 'deal_b'],
    ]);
    // ⭐ On a dry run EVERY scanned row is still NULL — the honest answer to
    // "what stays invisible if I stop here?".
    expect(report.totals).toEqual({ scanned: 9, planned: 3, written: 0, residualNull: 9, orphans: 1 });
  });

  it('⭐ the residue is broken out by reason, and the orphan is counted AND logged — never deleted', async () => {
    const warn = vi.fn();
    const info = vi.fn();
    const engine = seeded();
    const report = await planSysRecordShareOrganizationBackfill(engine, { logger: { warn, info } });
    expect(report.residue).toEqual({
      unaddressable: 1,
      subjectObjectUnknown: 1,
      subjectNotOrganizationScoped: 2,   // sys_setting (opt-out) + ext_note (no column)
      subjectReadFailed: 0,
      recordNotFound: 1,
      recordHasNoOrganization: 1,
    });
    const reasons = Object.fromEntries(report.residualRows.map((r) => [r.id, r.reason]));
    expect(reasons).toEqual({
      shr_orphan: 'recordNotFound',
      shr_orgless: 'recordHasNoOrganization',
      shr_setting: 'subjectNotOrganizationScoped',
      shr_note: 'subjectNotOrganizationScoped',
      shr_unknown: 'subjectObjectUnknown',
      shr_unaddressable: 'unaddressable',
    });
    // The logged count, on `warn`, naming the deleter that is NOT this module.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/1 grant row\(s\) reference a record that no longer exists/);
    expect(String(warn.mock.calls[0]![0])).toMatch(/left NULL, not deleted/);
    expect(warn.mock.calls[0]![1]).toMatchObject({ orphans: 1, dryRun: true });
    expect(info).toHaveBeenCalledTimes(1);
    // The orphan row is still there.
    expect(engine._rows(SYS_RECORD_SHARE_BACKFILL_OBJECT).some((r) => r.id === 'shr_orphan')).toBe(true);
  });

  it('a subject read that FAILS leaves that object\'s rows alone as "could not ask" — the others still plan', async () => {
    const engine = seeded({ failFindFor: new Set(['crm_case']) });
    const report = await planSysRecordShareOrganizationBackfill(engine);
    expect(report.residue.subjectReadFailed).toBe(1);
    expect(report.residualRows.find((r) => r.id === 'shr_case_a')?.reason).toBe('subjectReadFailed');
    expect(report.rows.map((r) => r.id)).toEqual(['shr_deal_a', 'shr_deal_b']);
    expect(report.notes.some((n) => /subject read on 'crm_case' failed/.test(n))).toBe(true);
  });

  it('no organization column on sys_record_share ⇒ nothing scanned, said out loud', async () => {
    const engine = createFakeEngine({
      schemas: { ...baseSchemas, sys_record_share: { fields: { id: {}, object_name: {}, record_id: {} } } },
      rows: { sys_record_share: [grant('shr_1', 'crm_deal', 'deal_a')], crm_deal: [] },
    });
    const report = await planSysRecordShareOrganizationBackfill(engine);
    expect(report.organizationField).toBeNull();
    expect(report.scanned).toBe(0);
    expect(report.notes[0]).toMatch(/no organization column resolved/);
  });

  it('a wall column the subject declares by name is honoured, never a hard-coded `organization_id`', async () => {
    const engine = createFakeEngine({
      schemas: {
        ...baseSchemas,
        hr_region: { fields: { id: {}, region_org: {}, organization_id: {} }, tenancy: { tenantField: 'region_org' } },
      },
      rows: {
        hr_region: [{ id: 'reg_1', region_org: ORG_B, organization_id: ORG_A }],
        sys_record_share: [grant('shr_reg', 'hr_region', 'reg_1')],
      },
    });
    const report = await planSysRecordShareOrganizationBackfill(engine);
    expect(report.rows.map((r) => [r.id, r.organization])).toEqual([['shr_reg', ORG_B]]);
  });
});

describe('[#14484] sys_record_share organization backfill — apply', () => {
  it('writes ONE update per planned row, with the organization threaded on the write context, and nothing else', async () => {
    const engine = seeded();
    const plan = await planSysRecordShareOrganizationBackfill(engine);
    const applied = await applySysRecordShareOrganizationBackfill(engine, plan);
    expect(applied.dryRun).toBe(false);
    expect(applied.written).toBe(3);
    expect(applied.failures).toEqual([]);
    expect(engine._updates.map((u) => [u.object, u.data, (u.context as any)?.isSystem, (u.context as any)?.tenantId])).toEqual([
      ['sys_record_share', { id: 'shr_case_a', organization_id: ORG_A }, true, ORG_A],
      ['sys_record_share', { id: 'shr_deal_a', organization_id: ORG_A }, true, ORG_A],
      ['sys_record_share', { id: 'shr_deal_b', organization_id: ORG_B }, true, ORG_B],
    ]);
    expect(orgOf(engine, 'shr_deal_a')).toBe(ORG_A);
    expect(orgOf(engine, 'shr_deal_b')).toBe(ORG_B);
    expect(orgOf(engine, 'shr_case_a')).toBe(ORG_A);
    // Residue untouched, orphan still present.
    for (const id of ['shr_orphan', 'shr_orgless', 'shr_setting', 'shr_note', 'shr_unknown', 'shr_unaddressable']) {
      expect(orgOf(engine, id), id).toBeNull();
    }
    expect(applied.totals).toEqual({ scanned: 9, planned: 3, written: 3, residualNull: 6, orphans: 1 });
  });

  it('a plan-then-apply run logs the orphan count ONCE — the apply half never re-says it', async () => {
    const warn = vi.fn();
    const engine = seeded();
    const report = await runSysRecordShareOrganizationBackfill(engine, { dryRun: false, logger: { warn } });
    expect(report.totals.orphans).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a row whose write throws is recorded, and the sweep continues', async () => {
    const engine = seeded({ failUpdateFor: new Set(['shr_deal_b']) });
    const report = await runSysRecordShareOrganizationBackfill(engine, { dryRun: false });
    expect(report.written).toBe(2);
    expect(report.failures).toEqual([{ id: 'shr_deal_b', error: 'simulated write refusal for shr_deal_b' }]);
    expect(orgOf(engine, 'shr_deal_a')).toBe(ORG_A);
    expect(orgOf(engine, 'shr_deal_b')).toBeNull();
  });

  it('IDEMPOTENT: a second run plans nothing, writes nothing, and re-reports the residue', async () => {
    const engine = seeded();
    await runSysRecordShareOrganizationBackfill(engine, { dryRun: false });
    const second = await runSysRecordShareOrganizationBackfill(engine, { dryRun: false });
    expect(second).toMatchObject({ scanned: 6, planned: 0, written: 0 });
    expect(second.totals.orphans).toBe(1);
    expect(engine._updates).toHaveLength(3);
  });
});

describe('[#14484] ⭐ the cliff — a strict organization wall over the grant table', () => {
  // A tenant-scoped read of `sys_record_share` under a strict wall, as Layer 0
  // composes it for the `isolated` posture: `organization_id = <active org>`.
  const tenantRead = (engine: ReturnType<typeof seeded>, org: string) =>
    engine.find(SYS_RECORD_SHARE_BACKFILL_OBJECT, { where: { object_name: 'crm_deal' }, context: { userId: 'u', tenantId: org } });
  const bareRead = (engine: ReturnType<typeof seeded>) =>
    engine.find(SYS_RECORD_SHARE_BACKFILL_OBJECT, { where: { object_name: 'crm_deal' }, context: { isSystem: true } });
  const ids = (rows: unknown[]) => (rows as Array<{ id: string }>).map((r) => r.id).sort();

  it('BEFORE the repair: the bare read returns the legacy grants, the tenant-scoped read returns NONE of them', async () => {
    const engine = seeded({ strictWall: true });
    const bare = ids(await bareRead(engine));
    expect(bare).toContain('shr_deal_a');
    expect(bare).toContain('shr_deal_b');
    // The card's ③: every organization-less grant "silently disappears" —
    // only the one row already stamped survives the wall.
    expect(ids(await tenantRead(engine, ORG_A))).toEqual(['shr_already']);
    expect(ids(await tenantRead(engine, ORG_B))).toEqual([]);
  });

  it('AFTER the repair: the tenant-scoped read equals the bare read filtered to that organization', async () => {
    const engine = seeded({ strictWall: true });
    await runSysRecordShareOrganizationBackfill(engine, { dryRun: false });

    const bare = (await bareRead(engine)) as Array<{ id: string; organization_id: string | null }>;
    const bareForA = bare.filter((r) => r.organization_id === ORG_A).map((r) => r.id).sort();
    const bareForB = bare.filter((r) => r.organization_id === ORG_B).map((r) => r.id).sort();

    expect(ids(await tenantRead(engine, ORG_A))).toEqual(bareForA);
    expect(ids(await tenantRead(engine, ORG_B))).toEqual(bareForB);
    expect(bareForA).toEqual(['shr_already', 'shr_deal_a']);
    expect(bareForB).toEqual(['shr_deal_b']);
    // …and the two organizations' reads are disjoint: the wall is live, not bypassed.
    expect(bareForA.filter((id) => bareForB.includes(id))).toEqual([]);
  });
});

describe('[#14484] sys_record_share organization backfill — the rendered report', () => {
  it('prints the residual-NULL total, the orphan count and the per-reason breakdown, for a dry run too', async () => {
    const engine = seeded();
    const text = formatSysRecordShareOrganizationBackfillReport(await planSysRecordShareOrganizationBackfill(engine));
    expect(text).toMatch(/DRY RUN \(nothing written\)/);
    expect(text).toMatch(/RESIDUAL NULL \(still invisible under a wall\) : 9/);
    expect(text).toMatch(/ORPHANS \(record gone; left NULL, counted\)    : 1/);
    expect(text).toMatch(/recordNotFound\s+1\s+— ORPHAN/);
    expect(text).toMatch(/shr_deal_a -> organization_id=org_a \(from crm_deal\/deal_a\)/);
    expect(text).toMatch(/shr_orphan stays NULL — recordNotFound \(crm_deal\/deal_gone\)/);
    expect(text).toMatch(/TOTAL scanned=9 would-write=3 residual-null=9 orphans=1/);
  });
});
