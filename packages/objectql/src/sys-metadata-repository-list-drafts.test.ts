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
    const names = (await repo.listDrafts()).map((d) => d.name).sort();
    expect(names).toEqual(['env_wide', 'org_scoped']);
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
});
