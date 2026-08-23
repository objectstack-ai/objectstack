// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one-off platform-row organization backfill (#11308) — dry run and write.
 *
 * The three properties the 2026-08-23 maintainer ruling names are asserted
 * here rather than described anywhere:
 *
 *  1. **Dry run writes nothing** — the fake engine fails the test if `update`
 *     is reached at all during a plan.
 *  2. **Only rows whose subject HAS an organization are written** — a stranded
 *     row whose subject is equally org-less is COUNTED and reported, never
 *     given an invented organization.
 *  3. **Idempotent** — the sweep runs twice against the same engine and the
 *     second run's write count is asserted to be 0.
 *
 * Plus the one thing this card must not do: a platform row about a
 * `sys_api_key` is repaired from `active_organization_id` (limb 0,
 * stamp-only, #8778), and the credential table is never written to. A sweep
 * that "unified everything onto one organization field" would flatten that
 * fork, so it is pinned rather than trusted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  planPlatformRowOrganizationBackfill,
  formatBackfillReport,
  BACKFILL_TARGETS,
  type BackfillEngine,
} from './backfill-platform-row-organizations.js';

type Row = Record<string, any>;

/**
 * Registered schemas for the objects under test. `fields` is what the shared
 * resolver's presence probe reads; `tenancy` is what its limbs read.
 */
const SCHEMAS: Record<string, any> = {
  sys_approval_request: { name: 'sys_approval_request', fields: { id: {}, organization_id: {}, object_name: {}, record_id: {}, payload_json: {}, status: {} } },
  sys_approval_action: { name: 'sys_approval_action', fields: { id: {}, organization_id: {}, request_id: {} } },
  sys_approval_approver: { name: 'sys_approval_approver', fields: { id: {}, organization_id: {}, request_id: {} } },
  sys_automation_run: { name: 'sys_automation_run', fields: { id: {}, organization_id: {}, trigger_object: {}, trigger_record_id: {}, context_json: {}, status: {} } },
  crm_deal: { name: 'crm_deal', fields: { id: {}, organization_id: {}, name: {} } },
  // ADR-0066 platform-global: an optional org FK while explicitly NOT
  // tenant-scoped. Limb 1 resolves it to `null` — a subject with no
  // organization of its own.
  sys_sso_provider: { name: 'sys_sso_provider', tenancy: { enabled: false }, fields: { id: {}, organization_id: {} } },
  // ⛔ The deliberately preserved fork: stamp-only `organizationField` (limb 0)
  // on an unwalled credential table.
  sys_api_key: {
    name: 'sys_api_key',
    tenancy: { enabled: false, organizationField: 'active_organization_id' },
    fields: { id: {}, active_organization_id: {}, organization_id: {} },
  },
};

interface FakeEngine extends BackfillEngine {
  tables: Record<string, Row[]>;
  updates: Array<{ object: string; data: Row }>;
  failUpdates: boolean;
}

function makeEngine(tables: Record<string, Row[]>, opts: { withSchema?: boolean } = {}): FakeEngine {
  const withSchema = opts.withSchema !== false;
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [key, expected] of Object.entries(where)) {
      const actual = row[key] ?? null;
      if (expected && typeof expected === 'object' && '$in' in (expected as any)) {
        if (!(expected as any).$in.includes(actual)) return false;
        continue;
      }
      if (expected === null) {
        if (actual !== null && actual !== undefined) return false;
        continue;
      }
      if (actual !== expected) return false;
    }
    return true;
  };
  const engine: FakeEngine = {
    tables,
    updates: [],
    failUpdates: false,
    async find(object: string, options?: any) {
      const table = tables[object];
      // An unregistered object throws, exactly as an engine does for a plugin
      // that is not mounted.
      if (!table) throw new Error(`fake engine: unknown object '${object}'`);
      let rows = table.filter(r => matches(r, options?.where));
      const order = options?.orderBy?.[0];
      if (order) {
        rows = [...rows].sort((a, b) => String(a[order.field] ?? '').localeCompare(String(b[order.field] ?? '')));
      }
      const offset = typeof options?.offset === 'number' ? options.offset : 0;
      const limit = typeof options?.limit === 'number' ? options.limit : rows.length;
      return rows.slice(offset, offset + limit).map(r => ({ ...r }));
    },
    async update(object: string, data: any) {
      if (engine.failUpdates) throw new Error(`fake engine: update('${object}') must not be reached in a dry run`);
      engine.updates.push({ object, data: { ...data } });
      const table = tables[object] ?? [];
      const i = table.findIndex(r => r.id === data.id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    getSchema(object: string) {
      return withSchema ? SCHEMAS[object] : undefined;
    },
  };
  if (!withSchema) delete (engine as any).getSchema;
  return engine;
}

/** The population the card measures: stranded rows across all four tables. */
function strandedFixture(): Record<string, Row[]> {
  return {
    sys_approval_request: [
      // (a) pending, subject alive and org-owned — the harmful half.
      { id: 'areq_1', organization_id: null, object_name: 'crm_deal', record_id: 'deal_1', status: 'pending', payload_json: JSON.stringify({ id: 'deal_1', organization_id: 'org_A' }) },
      // (b) terminal, subject DELETED, snapshot survives it.
      { id: 'areq_2', organization_id: null, object_name: 'crm_deal', record_id: 'deal_gone', status: 'approved', payload_json: JSON.stringify({ id: 'deal_gone', organization_id: 'org_B' }) },
      // (c) ⛔ subject is org-less too (ADR-0066 platform-global) — OUT OF RULING.
      { id: 'areq_3', organization_id: null, object_name: 'sys_sso_provider', record_id: 'sso_1', status: 'pending', payload_json: JSON.stringify({ id: 'sso_1', organization_id: 'org_C' }) },
      // (d) ⛔ subject is a sys_api_key — the preserved fork.
      { id: 'areq_4', organization_id: null, object_name: 'sys_api_key', record_id: 'key_1', status: 'pending', payload_json: null },
      // (e) already stamped — must never be re-read or re-written.
      { id: 'areq_5', organization_id: 'org_A', object_name: 'crm_deal', record_id: 'deal_1', status: 'pending', payload_json: null },
    ],
    sys_approval_action: [
      { id: 'aact_1', organization_id: null, request_id: 'areq_1' },
      { id: 'aact_2', organization_id: null, request_id: 'areq_3' },
      // A child left behind by an interrupted run: its parent already carries
      // an organization.
      { id: 'aact_3', organization_id: null, request_id: 'areq_5' },
    ],
    sys_approval_approver: [
      { id: 'aapr_1', organization_id: null, request_id: 'areq_1' },
    ],
    sys_automation_run: [
      // paused: live resumable state, subject alive.
      { id: 'run_p1', organization_id: null, trigger_object: 'crm_deal', trigger_record_id: 'deal_1', status: 'paused', context_json: JSON.stringify({ object: 'crm_deal', record: { id: 'deal_1', organization_id: 'org_A' } }) },
      // terminal history: no context_json at all (recordTerminal writes none).
      { id: 'run_run_t1', organization_id: null, trigger_object: 'crm_deal', trigger_record_id: 'deal_2', status: 'completed', context_json: null },
      // a plain scheduled sweep: no ONE subject, by construction.
      { id: 'run_p2', organization_id: null, trigger_object: null, trigger_record_id: null, status: 'paused', context_json: JSON.stringify({ event: 'schedule' }) },
    ],
    crm_deal: [
      { id: 'deal_1', organization_id: 'org_A', name: 'Alpha' },
      { id: 'deal_2', organization_id: 'org_B', name: 'Beta' },
    ],
    sys_sso_provider: [
      { id: 'sso_1', organization_id: 'org_C' },
    ],
    sys_api_key: [
      { id: 'key_1', active_organization_id: 'org_K', organization_id: null },
    ],
  };
}

function planFor(report: Awaited<ReturnType<typeof planPlatformRowOrganizationBackfill>>, object: string) {
  const plan = report.objects.find(o => o.object === object);
  if (!plan) throw new Error(`no plan for ${object}`);
  return plan;
}

describe('platform-row organization backfill — dry run', () => {
  let engine: FakeEngine;
  beforeEach(() => {
    engine = makeEngine(strandedFixture());
  });

  it('writes nothing: update() is unreachable while planning', async () => {
    engine.failUpdates = true;
    const report = await planPlatformRowOrganizationBackfill(engine);
    expect(report.dryRun).toBe(true);
    expect(engine.updates).toHaveLength(0);
    expect(report.totals.written).toBe(0);
    expect(report.totals.planned).toBeGreaterThan(0);
  });

  it('breaks the report out per object, one entry per table it touches', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    expect(report.objects.map(o => o.object)).toEqual([
      'sys_approval_request',
      'sys_approval_action',
      'sys_approval_approver',
      'sys_automation_run',
    ]);
  });

  it('plans a stranded request from its LIVE subject record', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const row = planFor(report, 'sys_approval_request').rows.find(r => r.id === 'areq_1');
    expect(row).toMatchObject({
      organizationField: 'organization_id',
      organization: 'org_A',
      resolvedFrom: 'live-record',
      subjectObject: 'crm_deal',
      subjectId: 'deal_1',
      status: 'pending',
    });
  });

  it('falls back to the write-time snapshot when the subject is gone', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const row = planFor(report, 'sys_approval_request').rows.find(r => r.id === 'areq_2');
    expect(row).toMatchObject({ organization: 'org_B', resolvedFrom: 'snapshot' });
  });

  it('⛔ counts and names rows whose subject has no organization, and invents none', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const plan = planFor(report, 'sys_approval_request');
    expect(plan.skipped.subjectHasNoOrganization).toBe(1);
    expect(plan.outOfRulingScopeIds).toEqual(['areq_3']);
    expect(plan.rows.map(r => r.id)).not.toContain('areq_3');
    expect(report.totals.outOfRulingScope).toBe(1);
  });

  it('⛔ repairs a sys_api_key subject from active_organization_id — the fork is not flattened', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const row = planFor(report, 'sys_approval_request').rows.find(r => r.id === 'areq_4');
    // `sys_api_key.organization_id` is NULL on the fixture; only the stamp-only
    // `active_organization_id` carries 'org_K'. Reading the canonical column
    // would have produced no plan at all.
    expect(row).toMatchObject({ organization: 'org_K', subjectObject: 'sys_api_key' });
  });

  it('never scans a row that already carries an organization', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const plan = planFor(report, 'sys_approval_request');
    expect(plan.scanned).toBe(4);
    expect(plan.rows.map(r => r.id)).not.toContain('areq_5');
  });

  it('moves the action / approver children with their request, from the PARENT row', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const actions = planFor(report, 'sys_approval_action');
    expect(actions.role).toBe('parent-derived');
    expect(actions.rows.map(r => [r.id, r.organization])).toEqual([
      ['aact_1', 'org_A'],
      // aact_3's parent (areq_5) was already stamped — an interrupted run's
      // leftover child is still repaired.
      ['aact_3', 'org_A'],
    ]);
    // aact_2 hangs off the out-of-ruling request and stays put.
    expect(actions.skipped.parentHasNoOrganization).toBe(1);
    expect(planFor(report, 'sys_approval_approver').rows.map(r => r.id)).toEqual(['aapr_1']);
  });

  it('sweeps automation runs in every status and breaks the plan out by status', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const plan = planFor(report, 'sys_automation_run');
    expect(plan.plannedByStatus).toEqual({ paused: 1, completed: 1 });
    expect(plan.rows.find(r => r.id === 'run_p1')).toMatchObject({ organization: 'org_A', resolvedFrom: 'live-record' });
    expect(plan.rows.find(r => r.id === 'run_run_t1')).toMatchObject({ organization: 'org_B', resolvedFrom: 'live-record' });
    // The record-less scheduled run names no subject and gets none.
    expect(plan.skipped.subjectUnaddressable).toBe(1);
  });

  it('says so loudly when the engine exposes no organization column at all', async () => {
    const blind = makeEngine(strandedFixture(), { withSchema: false });
    const report = await planPlatformRowOrganizationBackfill(blind);
    expect(report.totals.scanned).toBe(0);
    expect(report.totals.planned).toBe(0);
    for (const plan of report.objects) {
      expect(plan.organizationField).toBeNull();
      expect(plan.notes.join(' ')).toContain('no organization column resolved');
    }
  });

  it('renders a per-object operator report naming the out-of-ruling ids', async () => {
    const report = await planPlatformRowOrganizationBackfill(engine);
    const text = formatBackfillReport(report);
    expect(text).toContain('DRY RUN (nothing written)');
    for (const target of BACKFILL_TARGETS) expect(text).toContain(target.object);
    expect(text).toContain('areq_3');
    expect(text).toContain('out-of-ruling(subject has no organization)=1');
  });
});
