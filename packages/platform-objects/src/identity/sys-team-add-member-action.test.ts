// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Add Member opened from a team carries that team.
//
// `sys_team_member.add_team_member` sits on the membership list's toolbar,
// where no team is in hand, so its dialog asks for the team as well as the
// user. The team-side copy on `sys_team` binds the team from the row it is
// opened on (`recordIdParam: 'teamId'`), so the dialog asks for the user
// alone. Both copies call the same endpoint behind the same gates; this file
// pins that the two agree on everything except where the team comes from.
import { describe, expect, it } from 'vitest';
import { SysTeam } from './sys-team.object.js';
import { SysTeamMember } from './sys-team-member.object.js';

interface ParamLike {
  name?: string;
  field?: string;
  objectOverride?: string;
  required?: boolean;
  defaultFromRow?: boolean;
}

interface ActionLike {
  name?: string;
  type?: string;
  target?: string;
  recordIdParam?: string;
  locations?: string[];
  visible?: { source?: string };
  params?: ParamLike[];
}

function action(object: { actions?: unknown[] }, name: string): ActionLike {
  const found = ((object.actions ?? []) as ActionLike[]).find((a) => a.name === name);
  expect(found, `${name} is declared`).toBeDefined();
  return found as ActionLike;
}

describe('sys_team.add_team_member — Add Member opened from a team', () => {
  const fromTeam = action(SysTeam, 'add_team_member');
  const fromList = action(SysTeamMember, 'add_team_member');

  it('is offered on the team row and the team record header', () => {
    expect(fromTeam.locations).toEqual(['list_item', 'record_header']);
  });

  it('binds the team from the row it is opened on, as teamId', () => {
    expect(fromTeam.recordIdParam).toBe('teamId');
    // The team is not asked for: no dialog param submits teamId.
    expect((fromTeam.params ?? []).map((p) => p.name)).not.toContain('teamId');
  });

  it('asks only for the user, through the membership row\'s sys_user lookup', () => {
    expect(fromTeam.params).toEqual([
      { name: 'userId', field: 'user_id', objectOverride: 'sys_team_member', required: true },
    ]);
  });

  it('calls the same endpoint behind the same gate as the membership-list copy', () => {
    expect(fromTeam.type).toBe('api');
    expect(fromTeam.target).toBe('/api/v1/auth/organization/add-team-member');
    expect(fromTeam.target).toBe(fromList.target);
    expect(fromTeam.visible?.source).toBeDefined();
    expect(fromTeam.visible?.source).toBe(fromList.visible?.source);
  });

  it('leaves the membership-list copy asking for the team, where none is in hand', () => {
    expect(fromList.locations).toEqual(['list_toolbar']);
    expect(fromList.recordIdParam).toBeUndefined();
    expect((fromList.params ?? []).map((p) => p.name)).toEqual(['teamId', 'userId']);
  });
});
