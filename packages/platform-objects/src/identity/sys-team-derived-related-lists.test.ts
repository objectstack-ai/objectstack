// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A team record's page lists no Sessions; a user's page still does.
 *
 * `sys_team` declares no record page, so its related lists are DERIVED: every
 * `lookup` / `master_detail` field whose `reference` is `sys_team` becomes a
 * related list on the team's detail page unless the field sets
 * `relatedList: false` (`FieldSchema.relatedList`; the reader is objectui's
 * `deriveRelatedLists`, cited in `packages/spec/liveness/field.json`).
 *
 * `sys_session.active_team_id` used to derive one. That list carried the
 * session object's only `list_toolbar` action, "Sign out other devices",
 * which revokes the CALLER's own other sessions — on a team record it read as
 * a team action and was not one. The field, its lookup and its label stay
 * (better-auth writes `activeTeamId` into it); only the derived list goes.
 *
 * The user's own Sessions list is a curated tab on `SysUserDetailPage`, keyed
 * on `sys_session.user_id`, and is where that action belongs: pinned unchanged.
 */

import { describe, expect, it } from 'vitest';
import * as PlatformObjects from '../index.js';
import { SysSession } from './sys-session.object.js';
import { SysUserDetailPage } from '../pages/sys-user.page.js';

type FieldDef = { type?: string; reference?: string; relatedList?: boolean | 'primary'; label?: string };
type ActionDef = { name?: string; locations?: string[] };
type ObjectDef = { name?: string; fields?: Record<string, FieldDef>; actions?: ActionDef[] };

const CATALOGUE: ObjectDef[] = [
  ...new Set(
    Object.values(PlatformObjects).filter(
      (v): v is ObjectDef =>
        !!v && typeof v === 'object' && typeof (v as ObjectDef).name === 'string' && !!(v as ObjectDef).fields,
    ),
  ),
];

/** `<child>.<field>` for every relationship field that derives a related list on `parent`. */
function derivedRelatedLists(parent: string): string[] {
  const out: string[] = [];
  for (const obj of CATALOGUE) {
    for (const [name, field] of Object.entries(obj.fields ?? {})) {
      if (field.type !== 'lookup' && field.type !== 'master_detail') continue;
      if (field.reference !== parent || field.relatedList === false) continue;
      out.push(`${obj.name}.${name}`);
    }
  }
  return out.sort();
}

describe('sys_team derived related lists (Setup → Teams → a team → Related)', () => {
  it('exclude sys_session', () => {
    const lists = derivedRelatedLists('sys_team');
    expect(lists.filter((l) => l.startsWith('sys_session.'))).toEqual([]);
    // Guard against over-applying: the team's members are still listed.
    expect(lists).toContain('sys_team_member.team_id');
  });

  it('keep sys_session.active_team_id as a lookup to sys_team, suppressed only as a related list', () => {
    const field = SysSession.fields.active_team_id as FieldDef;
    expect(field.type).toBe('lookup');
    expect(field.reference).toBe('sys_team');
    expect(field.label).toBe('Active Team');
    expect(field.relatedList).toBe(false);
  });
});

describe("the user's own Sessions related list is unchanged", () => {
  it('SysUserDetailPage lists sys_session by user_id', () => {
    const lists: Array<{ objectName?: string; relationshipField?: string }> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; properties?: { objectName?: string; relationshipField?: string } };
      if (n.type === 'record:related_list' && n.properties) lists.push(n.properties);
      Object.values(node).forEach(walk);
    };
    walk(SysUserDetailPage);
    expect(lists).toContainEqual(expect.objectContaining({ objectName: 'sys_session', relationshipField: 'user_id' }));
  });

  it('sys_session.user_id still derives a related list on sys_user', () => {
    expect(derivedRelatedLists('sys_user')).toContain('sys_session.user_id');
  });

  it('"Sign out other devices" stays the session list toolbar action', () => {
    const action = (SysSession.actions as ActionDef[]).find((a) => a.name === 'revoke_my_other_sessions');
    expect(action?.locations).toEqual(['list_toolbar']);
  });
});
