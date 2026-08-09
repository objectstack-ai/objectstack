// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SysMetadataRepository } from '@objectstack/metadata-protocol';

/**
 * ADR-0033 — `listDrafts` surfaces pending DRAFT rows (what an AI authored but
 * a human hasn't published). Unlike `list()` (hard-scoped to state='active'),
 * it reads state='draft' and can narrow by packageId, so the console's
 * "pending changes" view and a just-built app package aren't shown as empty.
 */
const ROWS = [
  { type: 'object', name: 'course', state: 'draft', package_id: 'app.edu', organization_id: null, updated_at: 't1', updated_by: 'ai' },
  { type: 'object', name: 'student', state: 'draft', package_id: 'app.edu', organization_id: null, updated_at: 't2', updated_by: 'ai' },
  { type: 'object', name: 'legacy', state: 'draft', package_id: null, organization_id: null, updated_at: 't3' },
  { type: 'view', name: 'course_list', state: 'draft', package_id: 'app.edu', organization_id: null, updated_at: 't5', updated_by: 'ai' },
  { type: 'object', name: 'live', state: 'active', package_id: 'app.edu', organization_id: null, updated_at: 't4' },
];

const matchesWhere = (r: any, clause: any): boolean =>
  Object.entries(clause).every(([k, v]) =>
    k === '$or'
      ? (v as any[]).some((c) => matchesWhere(r, c))
      : (r as any)[k] === v,
  );

function makeRepo(rows = ROWS, organizationId: string | null = null) {
  // Minimal engine whose find() does equality WHERE matching, plus `$or`.
  const find = vi.fn(async (_table: string, q: any) => {
    const where = q?.where ?? {};
    return rows.filter((r) => matchesWhere(r, where));
  });
  const engine = { find } as any;
  const repo = new SysMetadataRepository({ engine, organizationId, orgLabel: 'env' });
  return { repo, find };
}

describe('SysMetadataRepository.listDrafts (ADR-0033)', () => {
  it('returns only draft rows, projected with packageId (active rows excluded)', async () => {
    const { repo } = makeRepo();
    const out = await repo.listDrafts();
    expect(out.map((d) => d.name).sort()).toEqual(['course', 'course_list', 'legacy', 'student']);
    expect(out.find((d) => d.name === 'live')).toBeUndefined();
    expect(out.find((d) => d.name === 'course')).toMatchObject({
      type: 'object',
      packageId: 'app.edu',
      updatedAt: 't1',
      updatedBy: 'ai',
    });
    // legacy draft (no package) surfaces with packageId null
    expect(out.find((d) => d.name === 'legacy')).toMatchObject({ packageId: null });
  });

  it('filters by packageId', async () => {
    const { repo } = makeRepo();
    const out = await repo.listDrafts({ packageId: 'app.edu' });
    expect(out.map((d) => d.name).sort()).toEqual(['course', 'course_list', 'student']);
  });

  it('surfaces env-wide (org IS NULL) drafts even when the repo has a non-null active org', async () => {
    // Regression (orphaned-draft bug): AI-authored metadata is written env-wide
    // (organization_id NULL). A non-null active org used a strict equality that
    // dropped those drafts → they showed in preview but the Publish CTA never
    // appeared, so the user could not publish them.
    const { repo } = makeRepo(ROWS, 'org_acme');
    const names = (await repo.listDrafts()).map((d) => d.name).sort();
    expect(names).toEqual(['course', 'course_list', 'legacy', 'student']);
    expect(names).not.toContain('live');
  });

  it('returns both org-scoped and env-wide drafts for a non-null org, excluding other orgs', async () => {
    const rows = [
      { type: 'object', name: 'env_wide', state: 'draft', package_id: 'p', organization_id: null, updated_at: 't1' },
      { type: 'object', name: 'org_scoped', state: 'draft', package_id: 'p', organization_id: 'org_acme', updated_at: 't2' },
      { type: 'object', name: 'other_org', state: 'draft', package_id: 'p', organization_id: 'org_other', updated_at: 't3' },
    ];
    const { repo } = makeRepo(rows, 'org_acme');
    const out = await repo.listDrafts();
    expect(out.map((d) => d.name).sort()).toEqual(['env_wide', 'org_scoped']);
    // Each draft is projected with the scope it actually lives in, so the
    // publish/discard paths can promote/delete it in THAT scope rather than the
    // caller's active org — otherwise the env-wide row 404s as `no_draft`
    // (#3115). This projection is the contract those callers depend on.
    expect(out.find((d) => d.name === 'env_wide')?.organizationId).toBeNull();
    expect(out.find((d) => d.name === 'org_scoped')?.organizationId).toBe('org_acme');
  });

  it('filters by type', async () => {
    const { repo } = makeRepo();
    const out = await repo.listDrafts({ type: 'view' });
    expect(out.map((d) => d.name)).toEqual(['course_list']);
  });

  it('queries state=draft scoped to org, threading type + packageId into WHERE', async () => {
    const { repo, find } = makeRepo();
    await repo.listDrafts({ type: 'object', packageId: 'app.edu' });
    expect(find).toHaveBeenCalledWith('sys_metadata', {
      where: { organization_id: null, state: 'draft', type: 'object', package_id: 'app.edu' },
    });
  });

  /**
   * [#6599] The header projection is a DISCLOSURE BOUNDARY, not a payload-size
   * optimization — and it is the ONLY thing standing between a draft row and an
   * unmasked object schema on the wire.
   *
   * `GET /api/v1/meta/_drafts` (`packages/rest/src/rest-server.ts`) and
   * `GET /metadata/_drafts` (`packages/runtime/src/domains/meta.ts`) both call
   * `protocol.listDrafts()` and serve the result verbatim — no ADR-0106
   * `applyObjectSchemaMask`, no capability gate, nothing beyond `requireAuth`.
   * That is safe today for exactly one reason: this function reads six columns
   * and never touches the row's stored body. #6599 was filed believing the body
   * DID come through (`.item.fields.salary_grade`); it does not, and this case
   * is what keeps that true.
   *
   * So the moment anyone "helpfully" widens the projection to carry the item —
   * a Studio diff view wanting field-level detail is the obvious pull — both
   * routes start serving full object schemas, `requiredPermissions`, picklist
   * option values and `formula` business IP to any authenticated caller, and
   * ADR-0106's mask is bypassed wholesale via a route it never covered. This
   * test goes red at that instant. If you are here because it went red: the
   * widening needs the ADR-0106 projection (or an authoring gate) on BOTH
   * routes FIRST — see #6599 for the (a)/(b) fork.
   */
  it('projects headers ONLY — a draft row\'s stored body never reaches the caller (#6599)', async () => {
    // A draft row carrying everything ADR-0106 names as leaking with a field:
    // a sensitive picklist, the capability guarding it, and a formula.
    const sensitive = {
      name: 'account',
      fields: {
        salary_grade: {
          type: 'select',
          label: 'Salary Grade',
          options: [{ value: 'band_a', label: 'Band A' }],
          requiredPermissions: ['view_compensation'],
        },
        bonus_formula: { type: 'formula', formula: 'salary_grade == "band_a" ? 0.2 : 0.1' },
      },
    };
    const rows = [
      {
        type: 'object',
        name: 'account',
        state: 'draft',
        package_id: 'app.hr',
        organization_id: null,
        updated_at: 't1',
        updated_by: 'ai',
        // Both spellings the repository layer has used for the stored document.
        body: JSON.stringify(sensitive),
        metadata_json: JSON.stringify(sensitive),
      },
    ];
    const { repo } = makeRepo(rows as any);
    const out = await repo.listDrafts({ type: 'object' });

    // Exactly the six header keys — no `item`, no `body`, no `fields`.
    expect(Object.keys(out[0]).sort()).toEqual([
      'name',
      'organizationId',
      'packageId',
      'type',
      'updatedAt',
      'updatedBy',
    ]);

    // Whole-payload sweep: no residue of the schema anywhere in what is served.
    // Asserting on the serialized form (rather than key-by-key) is deliberate —
    // it catches a body smuggled in under ANY key name, which a key allowlist
    // check alone would miss.
    const wire = JSON.stringify(out);
    for (const secret of [
      'salary_grade',
      'bonus_formula',
      'view_compensation',
      'band_a',
      'formula',
      'fields',
    ]) {
      expect(wire).not.toContain(secret);
    }
  });
});
