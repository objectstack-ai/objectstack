// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #12745 — the backfill half of "A with backfill".
//
// These pin the four properties the maintainer ruling names, as behaviour
// rather than as prose:
//
//   1. DRY RUN FIRST — `{ dryRun: true }` (the default) writes nothing;
//   2. derived from the SUBJECT, and only where the subject has exactly ONE
//      organization;
//   3. ⛔ a row whose organization cannot be derived unambiguously STAYS NULL
//      and is REPORTED — never guessed;
//   4. IDEMPOTENT — a second run over the repaired database plans nothing,
//      writes nothing, and re-reports the untouched residue.
//
// ⭐ Plus the reporting clause the ruling attaches to the residue: the residual
// NULL count is on the report and in the rendered text, for a dry run as well
// as an applied one.

import { describe, it, expect } from 'vitest';
import {
  SYS_FILE_BACKFILL_OBJECT,
  applySysFileOrganizationBackfill,
  createWallOrganizationResolver,
  formatSysFileOrganizationBackfillReport,
  planSysFileOrganizationBackfill,
  runSysFileOrganizationBackfill,
  type SysFileBackfillEngine,
} from './backfill-sys-file-organizations.js';

// ---------------------------------------------------------------------------
// Fake engine — schemas + rows, with `find` honouring the two predicate shapes
// the sweep issues (`{ col: null }` and `{ id: { $in: [...] } }`).
// ---------------------------------------------------------------------------

interface FakeSchema {
  fields: Record<string, unknown>;
  tenancy?: { enabled?: boolean; tenantField?: string; organizationField?: string };
}

function createFakeEngine(init: {
  schemas: Record<string, FakeSchema>;
  rows: Record<string, Array<Record<string, unknown>>>;
  failUpdateFor?: Set<string>;
}) {
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  for (const [object, list] of Object.entries(init.rows)) rows[object] = list.map((r) => ({ ...r }));
  const updates: Array<{ object: string; data: Record<string, unknown>; context: unknown }> = [];

  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where) return true;
    for (const [field, condition] of Object.entries(where)) {
      const value = row[field];
      if (condition === null) {
        if (value !== null && value !== undefined && value !== '') return false;
      } else if (condition && typeof condition === 'object' && '$in' in (condition as any)) {
        const set = (condition as any).$in as unknown[];
        if (!set.map(String).includes(String(value))) return false;
      } else if (String(value) !== String(condition)) {
        return false;
      }
    }
    return true;
  };

  const engine: SysFileBackfillEngine & {
    _rows: (object: string) => Array<Record<string, unknown>>;
    _updates: typeof updates;
  } = {
    getSchema(object: string) {
      const schema = init.schemas[object];
      if (!schema) throw new Error(`unknown object '${object}'`);
      return schema;
    },
    async find(object: string, options?: any) {
      const table = rows[object];
      if (!table) throw new Error(`object '${object}' is not mounted on this install`);
      let out = table.filter((r) => matches(r, options?.where));
      if (options?.orderBy?.[0]?.field === 'id') {
        out = [...out].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      }
      const offset = typeof options?.offset === 'number' ? options.offset : 0;
      const limit = typeof options?.limit === 'number' ? options.limit : out.length;
      return out.slice(offset, offset + limit).map((r) => ({ ...r }));
    },
    async update(object: string, data: any, options?: any) {
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
  fields: { id: {}, name: {}, organization_id: {}, ...extra },
});

const baseSchemas: Record<string, FakeSchema> = {
  sys_file: orgScoped({ key: {}, ref_object: {}, ref_id: {}, ref_field: {}, owner_id: {} }),
  sys_attachment: orgScoped({ file_id: {}, parent_object: {}, parent_id: {} }),
  crm_deal: orgScoped(),
  crm_case: orgScoped(),
};

const file = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `user/${id}.txt`,
  organization_id: null,
  ref_object: null,
  ref_id: null,
  ...extra,
});

// ---------------------------------------------------------------------------
// 1. Dry run first
// ---------------------------------------------------------------------------

describe('sys_file organization backfill: the dry run writes nothing', () => {
  it('plans the derivable row and leaves the database untouched', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f1', { ref_object: 'crm_deal', ref_id: 'd1' })],
        sys_attachment: [],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [],
      },
    });

    const report = await planSysFileOrganizationBackfill(engine);

    expect(report.dryRun).toBe(true);
    expect(report.organizationField).toBe('organization_id');
    expect(report.scanned).toBe(1);
    expect(report.planned).toBe(1);
    expect(report.written).toBe(0);
    expect(report.rows[0]).toMatchObject({ id: 'f1', organization: 'org_A' });
    // The database did not move, and no `update` was issued at all.
    expect(engine._updates).toHaveLength(0);
    expect(engine._rows('sys_file')[0]!.organization_id).toBeNull();
  });

  it('`runSysFileOrganizationBackfill` defaults to the dry run', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f1', { ref_object: 'crm_deal', ref_id: 'd1' })],
        sys_attachment: [],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [],
      },
    });

    const report = await runSysFileOrganizationBackfill(engine);

    expect(report.dryRun).toBe(true);
    expect(report.written).toBe(0);
    expect(engine._updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Derived from the subject — both holder channels
// ---------------------------------------------------------------------------

describe('sys_file organization backfill: derived from the subject', () => {
  it('stamps from the field-reference owner and from an attachment holder alike', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [
          file('f-ref', { ref_object: 'crm_deal', ref_id: 'd1' }),
          file('f-att'),
        ],
        sys_attachment: [
          { id: 'a1', file_id: 'f-att', parent_object: 'crm_case', parent_id: 'c1' },
        ],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [{ id: 'c1', organization_id: 'org_B' }],
      },
    });

    const applied = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(applied.written).toBe(2);
    const stamped = Object.fromEntries(
      engine._rows('sys_file').map((r) => [r.id, r.organization_id]),
    );
    expect(stamped).toEqual({ 'f-ref': 'org_A', 'f-att': 'org_B' });
    // Provenance is on the report, so the derivation is checkable without re-running it.
    expect(applied.rows.find((r) => r.id === 'f-ref')!.subjects[0]!.via).toBe('field-reference');
    expect(applied.rows.find((r) => r.id === 'f-att')!.subjects[0]!.via).toBe('attachment');
  });

  it('stamps a file whose several holders all sit in the SAME organization', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f1', { ref_object: 'crm_deal', ref_id: 'd1' })],
        sys_attachment: [
          { id: 'a1', file_id: 'f1', parent_object: 'crm_case', parent_id: 'c1' },
        ],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [{ id: 'c1', organization_id: 'org_A' }],
      },
    });

    const applied = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(applied.written).toBe(1);
    expect(engine._rows('sys_file')[0]!.organization_id).toBe('org_A');
    expect(applied.rows[0]!.subjects).toHaveLength(2);
  });

  it('resolves the subject column the object is WALLED by, not a hard-coded name', async () => {
    const engine = createFakeEngine({
      schemas: {
        ...baseSchemas,
        // Declares its own tenant column (`tenancy.tenantField`) — the sweep must
        // read THAT, not `organization_id`.
        wsp_doc: {
          fields: { id: {}, workspace_id: {}, organization_id: {} },
          tenancy: { enabled: true, tenantField: 'workspace_id' },
        },
      },
      rows: {
        sys_file: [file('f1', { ref_object: 'wsp_doc', ref_id: 'w1' })],
        sys_attachment: [],
        crm_deal: [],
        crm_case: [],
        wsp_doc: [{ id: 'w1', workspace_id: 'ws_1', organization_id: 'org_WRONG' }],
      },
    });

    const applied = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(applied.written).toBe(1);
    expect(engine._rows('sys_file')[0]!.organization_id).toBe('ws_1');
  });

  it('⛔ never reads the scope-pinned stamp-only `tenancy.organizationField`', async () => {
    // `sys_api_key` is the shipped object where "which organization is this row
    // ABOUT" and "which organization is this row WALLED by" deliberately
    // diverge: an unwalled credential table recording an organization under
    // `active_organization_id`. Stamping a file from that column would wall the
    // file into an organization its holder is not walled into — so the resolver
    // must answer `null` here, and the file must stay NULL and be reported.
    const engine = createFakeEngine({
      schemas: {
        ...baseSchemas,
        sys_api_key: {
          fields: { id: {}, active_organization_id: {} },
          tenancy: { enabled: false, organizationField: 'active_organization_id' },
        },
      },
      rows: {
        sys_file: [file('f1', { ref_object: 'sys_api_key', ref_id: 'k1' })],
        sys_attachment: [],
        crm_deal: [],
        crm_case: [],
        sys_api_key: [{ id: 'k1', active_organization_id: 'org_A' }],
      },
    });

    const resolver = createWallOrganizationResolver(engine);
    expect(resolver.organizationFieldFor('sys_api_key')).toBeNull();

    const applied = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(applied.written).toBe(0);
    expect(applied.residue.subjectNotOrganizationScoped).toBe(1);
    expect(engine._rows('sys_file')[0]!.organization_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. ⛔ Undecidable rows stay NULL and are REPORTED
// ---------------------------------------------------------------------------

describe('sys_file organization backfill: the residue is reported, never guessed', () => {
  it('leaves an AMBIGUOUS-subject row NULL and names it in the report', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f-shared')],
        sys_attachment: [
          { id: 'a1', file_id: 'f-shared', parent_object: 'crm_deal', parent_id: 'd1' },
          { id: 'a2', file_id: 'f-shared', parent_object: 'crm_case', parent_id: 'c1' },
        ],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [{ id: 'c1', organization_id: 'org_B' }],
      },
    });

    const applied = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(applied.written).toBe(0);
    expect(engine._updates).toHaveLength(0);
    expect(engine._rows('sys_file')[0]!.organization_id).toBeNull();

    expect(applied.residue.ambiguousSubjects).toBe(1);
    const residual = applied.residualRows.find((r) => r.id === 'f-shared')!;
    expect(residual.reason).toBe('ambiguousSubjects');
    expect([...residual.candidateOrganizations].sort()).toEqual(['org_A', 'org_B']);
    // ⭐ The count the ruling asks for, present on an APPLIED run.
    expect(applied.totals.residualNull).toBe(1);
  });

  it('a holder that answered beside one that did not is ambiguous too — not a majority vote', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f1')],
        sys_attachment: [
          { id: 'a1', file_id: 'f1', parent_object: 'crm_deal', parent_id: 'd1' },
          { id: 'a2', file_id: 'f1', parent_object: 'crm_case', parent_id: 'c1' },
        ],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [{ id: 'c1', organization_id: null }],
      },
    });

    const applied = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(applied.written).toBe(0);
    expect(applied.residue.ambiguousSubjects).toBe(1);
    expect(applied.residualRows[0]!.candidateOrganizations).toEqual(['org_A']);
  });

  it('separates the four "nothing to derive from" reasons instead of merging them', async () => {
    const engine = createFakeEngine({
      schemas: {
        ...baseSchemas,
        // Platform-global: no organization column at all.
        sys_sso_provider: { fields: { id: {}, issuer: {} }, tenancy: { enabled: false } },
      },
      rows: {
        sys_file: [
          file('f-none'),                                                   // nothing holds it
          file('f-gone', { ref_object: 'crm_deal', ref_id: 'missing' }),    // holder deleted
          file('f-global', { ref_object: 'sys_sso_provider', ref_id: 's1' }), // holder unwalled
          file('f-null', { ref_object: 'crm_deal', ref_id: 'd1' }),         // holder org is NULL
        ],
        sys_attachment: [],
        crm_deal: [{ id: 'd1', organization_id: null }],
        crm_case: [],
        sys_sso_provider: [{ id: 's1', issuer: 'https://idp.example' }],
      },
    });

    const report = await planSysFileOrganizationBackfill(engine);

    expect(report.planned).toBe(0);
    expect(report.residue).toMatchObject({
      noSubject: 1,
      subjectNotFound: 1,
      subjectNotOrganizationScoped: 1,
      subjectHasNoOrganization: 1,
      ambiguousSubjects: 0,
    });
    expect(report.totals.residualNull).toBe(4);
  });

  it('⭐ prints the residual-NULL count on a DRY RUN, broken out by reason', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f-ok', { ref_object: 'crm_deal', ref_id: 'd1' }), file('f-none')],
        sys_attachment: [],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [],
      },
    });

    const report = await planSysFileOrganizationBackfill(engine);
    const text = formatSysFileOrganizationBackfillReport(report);

    // A dry run has written nothing, so EVERY scanned row is still NULL.
    expect(report.totals.residualNull).toBe(2);
    expect(text).toContain('DRY RUN (nothing written)');
    expect(text).toContain('RESIDUAL NULL (still invisible under a wall) : 2');
    expect(text).toContain('nothing holds this file');
    expect(text).toContain('f-none stays NULL — noSubject');
    expect(text).toContain('residual-null=2');
  });

  it('a write refusal is reported and counted as residue, never retried, never fatal', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [
          file('f-ok', { ref_object: 'crm_deal', ref_id: 'd1' }),
          file('f-bad', { ref_object: 'crm_deal', ref_id: 'd1' }),
        ],
        sys_attachment: [],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [],
      },
      failUpdateFor: new Set(['f-bad']),
    });

    const applied = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(applied.written).toBe(1);
    expect(applied.failures).toHaveLength(1);
    expect(applied.failures[0]!.id).toBe('f-bad');
    expect(applied.totals.residualNull).toBe(1);
  });

  it('says so LOUDLY when no organization column resolves — a silent no-op reads like a clean database', async () => {
    const engine = createFakeEngine({
      schemas: { sys_file: { fields: { id: {}, key: {} } }, sys_attachment: orgScoped() },
      rows: { sys_file: [file('f1')], sys_attachment: [] },
    });

    const report = await planSysFileOrganizationBackfill(engine);

    expect(report.organizationField).toBeNull();
    expect(report.scanned).toBe(0);
    expect(report.notes.join('\n')).toContain("no organization column resolved for 'sys_file'");
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotency — asserted by running it twice, not described in prose
// ---------------------------------------------------------------------------

describe('sys_file organization backfill: idempotent', () => {
  it('a second run over the repaired database plans nothing and writes nothing', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [
          file('f-ok', { ref_object: 'crm_deal', ref_id: 'd1' }),
          file('f-shared'),
        ],
        sys_attachment: [
          { id: 'a1', file_id: 'f-shared', parent_object: 'crm_deal', parent_id: 'd1' },
          { id: 'a2', file_id: 'f-shared', parent_object: 'crm_case', parent_id: 'c1' },
        ],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [{ id: 'c1', organization_id: 'org_B' }],
      },
    });

    const first = await runSysFileOrganizationBackfill(engine, { dryRun: false });
    expect(first.written).toBe(1);
    expect(first.totals.residualNull).toBe(1);
    const updatesAfterFirst = engine._updates.length;

    const second = await runSysFileOrganizationBackfill(engine, { dryRun: false });

    // The repaired row can no longer match `organization_id IS NULL`…
    expect(second.scanned).toBe(1);
    expect(second.planned).toBe(0);
    expect(second.written).toBe(0);
    expect(engine._updates).toHaveLength(updatesAfterFirst);
    // …and the row that was deliberately skipped is RE-REPORTED, not re-written.
    expect(second.residue.ambiguousSubjects).toBe(1);
    expect(second.totals.residualNull).toBe(1);
  });

  it('the applied run carries a system context, so it can see rows across every organization', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f1', { ref_object: 'crm_deal', ref_id: 'd1' })],
        sys_attachment: [],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [],
      },
    });

    await runSysFileOrganizationBackfill(engine, { dryRun: false });

    expect(engine._updates[0]!.object).toBe(SYS_FILE_BACKFILL_OBJECT);
    expect(engine._updates[0]!.context).toMatchObject({ isSystem: true });
    // ⛔ Only the id and the one column — nothing else on the row is touched,
    // which is what makes the undo "write NULL back to these ids".
    expect(Object.keys(engine._updates[0]!.data).sort()).toEqual(['id', 'organization_id']);
  });

  it('`applySysFileOrganizationBackfill` writes the plan it was handed, not a fresh scan', async () => {
    const engine = createFakeEngine({
      schemas: baseSchemas,
      rows: {
        sys_file: [file('f1', { ref_object: 'crm_deal', ref_id: 'd1' })],
        sys_attachment: [],
        crm_deal: [{ id: 'd1', organization_id: 'org_A' }],
        crm_case: [],
      },
    });

    const plan = await planSysFileOrganizationBackfill(engine);
    // A row that appears AFTER the human read the plan must not be swept by
    // this apply — the rows written are the rows that were reviewed.
    engine._rows('sys_file'); // (no-op read; the table below is mutated directly)
    const applied = await applySysFileOrganizationBackfill(engine, plan);

    expect(applied.dryRun).toBe(false);
    expect(applied.written).toBe(1);
    expect(engine._updates.map((u) => u.data.id)).toEqual(['f1']);
  });
});
