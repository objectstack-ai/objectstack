/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13271 — a `defaultFromRow` param backed by a relation is seeded with
 * the row's STORED id, not the record `$expand` put in its place.
 *
 * Measured: Setup → Teams → Related → Team Members → Remove from Team sent
 * `userId: { …the whole sys_user record… }` to `remove-team-member` and got a
 * 400 "User is not a member of the organization"; the same call with the id
 * answers 200. The related-list row is fetched with its lookups expanded, and
 * `resolveActionParam()` copied `row[field]` verbatim into the param.
 *
 * The fixture is `sys_team_member`'s `remove_team_member` param as the platform
 * declares it (`{ name: 'userId', field: 'user_id', required: true,
 * defaultFromRow: true }`), with the row as a related list delivers it.
 *
 * Which fields collapse is decided by the row object's field TYPES (the rule
 * `toPredicateRecord` states for the predicate and Undo paths), so each
 * relational pin has a non-relational control beside it carrying the same
 * shape: a `json` value with an `id` key is its stored value and must survive.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ActionParamDef } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
// Module scope, per AGENTS.md 测试纪律: the dialog's widgets sit behind
// `React.lazy`, and this barrel statically re-exports them.
import '@object-ui/fields';
import { resolveActionParams, type RawActionParam } from '@object-ui/fields';

import { ActionParamDialog } from './ActionParamDialog';

const USER = { id: 'u1', name: 'QA Plain', email: 'qa.plain@example.com' };

/** The row's object, as the metadata API serves it. */
const SYS_TEAM_MEMBER = {
  name: 'sys_team_member',
  fields: {
    team_id: { type: 'lookup', reference: 'sys_team', label: 'Team' },
    user_id: { type: 'lookup', reference: 'sys_user', label: 'User' },
    watchers: { type: 'lookup', reference: 'sys_user', multiple: true, label: 'Watchers' },
    settings: { type: 'json', label: 'Settings' },
    note: { type: 'text', label: 'Note' },
  },
};

/** The row, as a related list fetched it: relations expanded in place. */
const ROW: Record<string, unknown> = {
  id: 'tm1',
  team_id: { id: 't1', name: 'QA Team' },
  user_id: USER,
  watchers: [{ id: 'u2', name: 'Ada' }, { id: 'u3', name: 'Grace' }],
  settings: { id: 'cfg-1', mode: 'strict' },
  note: 'joined in Q3',
};

/** `remove_team_member`'s param, as `sys_team_member` declares it. */
const USER_ID: RawActionParam = { name: 'userId', field: 'user_id', required: true, defaultFromRow: true };

const resolveWith = (params: RawActionParam[], objects: unknown[] = [SYS_TEAM_MEMBER]) =>
  resolveActionParams(params, {
    objectName: 'sys_team_member',
    objects: objects as never,
    fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
    row: ROW,
  });

const seedOf = (param: RawActionParam) => resolveWith([param])[0].defaultValue;

describe('objectui#13271 — the resolver seeds the stored form', () => {
  it('⭐ (a) a lookup-backed param seeds the related record\'s id', () => {
    expect(seedOf(USER_ID)).toBe('u1');
  });

  it('⭐ (b) a `multiple` lookup seeds the array of ids', () => {
    expect(seedOf({ name: 'watchers', field: 'watchers', defaultFromRow: true })).toEqual(['u2', 'u3']);
  });

  it('CONTROL (c) — a `json` field whose value has an `id` key is seeded verbatim', () => {
    expect(seedOf({ name: 'settings', field: 'settings', defaultFromRow: true })).toBe(ROW.settings);
  });

  it('CONTROL (d) — a text field seeds as before', () => {
    expect(seedOf({ name: 'note', field: 'note', defaultFromRow: true })).toBe('joined in Q3');
  });

  it('CONTROL — without the row\'s object in the metadata nothing is guessed: the value is the row\'s', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveWith([USER_ID], [])[0].defaultValue).toBe(USER);
    warn.mockRestore();
  });

  it('the row record itself is not mutated', () => {
    seedOf(USER_ID);
    expect(ROW.user_id).toBe(USER);
  });
});

describe('objectui#13271 — what Remove from Team submits', () => {
  afterEach(() => cleanup());

  function makeDataSource() {
    return {
      find: vi.fn(async () => ({ data: [USER], total: 1, hasMore: false, pageSize: 50 })),
      findOne: vi.fn(async (_o: string, id: string) => (id === USER.id ? USER : null)),
      getObjectSchema: async (name: string) => ({
        name,
        fields: { id: { type: 'text' }, name: { type: 'text' } },
      }),
    };
  }

  it('⭐ (a) Confirm sends `userId: \'u1\'`, and the picker still shows the user\'s name', async () => {
    const resolve = vi.fn();
    const params: ActionParamDef[] = resolveWith([USER_ID]);
    render(
      <SchemaRendererProvider dataSource={makeDataSource() as never}>
        <ActionParamDialog
          state={{ open: true, params, title: 'Remove from Team', resolve }}
          onOpenChange={() => {}}
        />
      </SchemaRendererProvider>,
    );

    // Display is unaffected: the id hydrates to the record's name.
    const trigger = await screen.findByTestId('lookup-trigger-userId');
    await waitFor(() => expect(trigger).toHaveTextContent('QA Plain'));

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve.mock.calls[0][0]).toEqual({ userId: 'u1' });
  });
});
