// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24948] The organization-delete refusal and the auth-structure removal, at
 * the seam: what is counted as a record, what is the organization's own
 * structure, and in which order the structure goes.
 *
 * The door, booted on SQLite with the real better-auth endpoint, is pinned in
 * `packages/qa/dogfood/test/organization-delete-refuse-nonempty.dogfood.test.ts`;
 * the engine's own refusal in `packages/objectql/src/engine-organization-delete-refusal.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ORGANIZATION_ADMIN, ORGANIZATION_ADMIN_NO_BYPASS } from '@objectstack/spec';
import {
  ORGANIZATION_AUTH_STRUCTURE,
  isDefaultOrganizationTarget,
  organizationDeleteRefusal,
  organizationNotEmptyBody,
  removeOrganizationAuthStructure,
} from './organization-delete.js';

type Row = Record<string, any>;

const ORG = 'org_1';

/** A data engine over in-memory tables that records every call. */
function makeEngine(tables: Record<string, Row[]>, owned: Array<{ object: string; count: number }> = []) {
  const calls: string[] = [];
  const asked: Array<{ organizationId: string; exclude: string[] }> = [];
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && Array.isArray(v.$in)) return v.$in.includes(row[k]);
      return (row[k] ?? null) === (v ?? null);
    });
  const engine: any = {
    async find(object: string, q: any) {
      calls.push(`find ${object}`);
      return (tables[object] ?? []).filter((r) => matches(r, q?.where));
    },
    async count(object: string, q: any) {
      calls.push(`count ${object}`);
      return (tables[object] ?? []).filter((r) => matches(r, q?.where)).length;
    },
    async delete(object: string, q: any) {
      calls.push(`delete ${object}${q?.multi ? ' multi' : ''}`);
      expect(q?.context?.isSystem, `${object} is deleted as the system`).toBe(true);
      tables[object] = (tables[object] ?? []).filter((r) => !matches(r, q?.where));
      return true;
    },
    async organizationOwnedRowCounts(organizationId: string, options?: { exclude?: Iterable<string> }) {
      asked.push({ organizationId, exclude: [...(options?.exclude ?? [])] });
      return owned.map((o) => ({ ...o }));
    },
  };
  return { engine, calls, asked, tables };
}

describe('[#24948] organizationDeleteRefusal: the records the organization still owns', () => {
  it('asks the engine with the organization\'s own auth structure excluded', async () => {
    const { engine, asked } = makeEngine({}, [{ object: 'crm_account', count: 3 }]);
    expect(await organizationDeleteRefusal(engine, ORG)).toEqual([{ object: 'crm_account', count: 3 }]);
    expect(asked).toEqual([{ organizationId: ORG, exclude: [...ORGANIZATION_AUTH_STRUCTURE] }]);
    expect([...ORGANIZATION_AUTH_STRUCTURE].sort()).toEqual(
      ['sys_invitation', 'sys_member', 'sys_team', 'sys_team_member', 'sys_user_permission_set'],
    );
  });

  it('counts every grant scoped to the organization except the organization-admin ones, NULL-named grants included', async () => {
    const { engine } = makeEngine({
      sys_user_permission_set: [
        { organization_id: ORG, permission_set: ORGANIZATION_ADMIN },
        { organization_id: ORG, permission_set: ORGANIZATION_ADMIN_NO_BYPASS },
        { organization_id: ORG, permission_set: 'sales_rep' },
        { organization_id: ORG, permission_set: null },
        { organization_id: 'org_other', permission_set: 'sales_rep' },
      ],
    });
    expect(await organizationDeleteRefusal(engine, ORG)).toEqual([{ object: 'sys_user_permission_set', count: 2 }]);
  });

  it('is empty for an organization holding only its organization-admin grants', async () => {
    const { engine } = makeEngine({
      sys_user_permission_set: [{ organization_id: ORG, permission_set: ORGANIZATION_ADMIN }],
    });
    expect(await organizationDeleteRefusal(engine, ORG)).toEqual([]);
  });

  it('answers undefined for an engine that cannot count, leaving the decision to the engine\'s cascade', async () => {
    const { engine } = makeEngine({});
    delete engine.organizationOwnedRowCounts;
    expect(await organizationDeleteRefusal(engine, ORG)).toBeUndefined();
  });

  it('propagates a count that fails: a guard that could not be evaluated does not pass', async () => {
    const { engine } = makeEngine({});
    const fault = new Error('connection lost');
    engine.organizationOwnedRowCounts = async () => { throw fault; };
    await expect(organizationDeleteRefusal(engine, ORG)).rejects.toBe(fault);
  });
});

describe('[#24948] organizationNotEmptyBody: the 409 body', () => {
  it('is the standard DELETE_RESTRICTED code with every table and its count, and the remedy', () => {
    const body = organizationNotEmptyBody([
      { object: 'crm_account', count: 3 },
      { object: 'crm_contact', count: 1 },
    ]);
    expect(body.code).toBe('DELETE_RESTRICTED');
    expect(body.dependents).toEqual([
      { object: 'crm_account', count: 3 },
      { object: 'crm_contact', count: 1 },
    ]);
    expect(body.message).toContain('crm_account (3)');
    expect(body.message).toContain('Delete or move those records first');
  });
});

describe('[#24948] isDefaultOrganizationTarget: the last-administrator guard\'s reading of the anchor', () => {
  it('is the `default` slug, whatever else exists', async () => {
    const { engine } = makeEngine({ sys_organization: [{ id: 'a' }, { id: 'b' }] });
    expect(await isDefaultOrganizationTarget(engine, { id: 'a', slug: 'default' }, false)).toBe(true);
  });

  it('is the only organization, whatever its slug', async () => {
    const { engine } = makeEngine({ sys_organization: [{ id: 'a', slug: 'acme' }] });
    expect(await isDefaultOrganizationTarget(engine, { id: 'a', slug: 'acme' }, false)).toBe(true);
  });

  it('CONTROL: another organization, beside others, is not', async () => {
    const { engine } = makeEngine({ sys_organization: [{ id: 'a' }, { id: 'b' }] });
    expect(await isDefaultOrganizationTarget(engine, { id: 'b', slug: 'acme' }, false)).toBe(false);
  });

  it('is never one under a walled posture, where no organization anchors platform standing', async () => {
    const { engine } = makeEngine({ sys_organization: [{ id: 'a', slug: 'default' }] });
    expect(await isDefaultOrganizationTarget(engine, { id: 'a', slug: 'default' }, true)).toBe(false);
  });
});

describe('[#24948] removeOrganizationAuthStructure: what better-auth leaves behind', () => {
  it('deletes the team members, then each team by id, then the organization-admin grants, and nothing else', async () => {
    const { engine, calls, tables } = makeEngine({
      sys_team: [
        { id: 't1', organization_id: ORG },
        { id: 't2', organization_id: 'org_other' },
      ],
      sys_team_member: [
        { id: 'tm1', team_id: 't1' },
        { id: 'tm2', team_id: 't2' },
      ],
      sys_user_permission_set: [
        { id: 'g1', organization_id: ORG, permission_set: ORGANIZATION_ADMIN },
        { id: 'g2', organization_id: ORG, permission_set: 'sales_rep' },
        { id: 'g3', organization_id: 'org_other', permission_set: ORGANIZATION_ADMIN },
      ],
    });

    await removeOrganizationAuthStructure(engine, ORG);

    expect(calls.filter((c) => c.startsWith('delete'))).toEqual([
      'delete sys_team_member multi',
      'delete sys_team',
      'delete sys_user_permission_set multi',
    ]);
    expect(tables.sys_team.map((r) => r.id)).toEqual(['t2']);
    expect(tables.sys_team_member.map((r) => r.id)).toEqual(['tm2']);
    // A grant that is not the organization's own structure stays: the refusal counted it.
    expect(tables.sys_user_permission_set.map((r) => r.id)).toEqual(['g2', 'g3']);
  });

  it('deletes no team member when the organization has no team', async () => {
    const { engine, calls } = makeEngine({ sys_team: [], sys_team_member: [{ id: 'tm1', team_id: 't9' }] });
    await removeOrganizationAuthStructure(engine, ORG);
    expect(calls).not.toContain('delete sys_team_member multi');
  });
});
