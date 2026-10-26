/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * PeoplePicker asks `$expand` only for relations the user may read —
 * objectui#10373.
 *
 * With no `expand` passed, PeoplePicker derives one from its dotted
 * `subtitleFields` (`primary_business_unit_id.name` ⇒ expand
 * `primary_business_unit_id`). That list had no permission read at all, while
 * every other `$expand` in this package — and every `buildExpandFields` call
 * site the objectui#7429 sweep touched — drops a relation the loaded policy
 * denies. `$expand` asks the server to RESOLVE the reference and return the
 * related record, a larger disclosure than the bare key.
 *
 * What is pinned, against the real `PermissionProvider` (not a stub), on the
 * object the picker queries (`sys_user`):
 *
 *  - a relation named by a `subtitle` path that the loaded policy denies is not
 *    in `$expand`, and its subtitle segment drops out of the row; the readable
 *    relation is still expanded and shown;
 *  - every relation denied ⇒ no `$expand` key at all, not an empty list;
 *  - a caller's explicit `expand` goes through the same gate — the gate reads
 *    the list that goes out, whichever source filled it;
 *  - with no policy loaded (no provider: `isLoaded` is false) nothing is
 *    filtered.
 */

import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionProvider } from '@object-ui/permissions';
import { PeoplePicker } from './PeoplePicker';

const BUSINESS_UNITS: Record<string, { id: string; name: string }> = {
  bu_1: { id: 'bu_1', name: 'Sales' },
};
const MANAGERS: Record<string, { id: string; name: string }> = {
  m_1: { id: 'm_1', name: 'Dana Boss' },
};

/** A backend that does NOT strip denied keys, and honours `$expand`. */
function makeDataSource() {
  const users = [
    { id: 'u1', name: 'Amy Lin', email: 'amy@x.io', primary_business_unit_id: 'bu_1', manager_id: 'm_1' },
  ];
  const find = vi.fn(async (_obj: string, params: any) => {
    const expand: string[] = Array.isArray(params?.$expand) ? params.$expand : [];
    const data = users.map((u) => ({
      ...u,
      ...(expand.includes('primary_business_unit_id')
        ? { primary_business_unit_id: BUSINESS_UNITS[u.primary_business_unit_id] }
        : {}),
      ...(expand.includes('manager_id') ? { manager_id: MANAGERS[u.manager_id] } : {}),
    }));
    return { data, total: data.length };
  });
  return { find } as any;
}

const SUBTITLE = ['primary_business_unit_id.name', 'manager_id.name', 'email'];

type Wrap = (node: React.ReactElement) => React.ReactElement;
const bare: Wrap = (node) => node;

/** The real role-based provider, denying the named `sys_user` fields to `viewer`. */
function denying(...fields: string[]): Wrap {
  return (node) => (
    <PermissionProvider
      roles={[]}
      userRoles={['viewer']}
      permissions={[
        {
          object: 'sys_user',
          roles: {
            viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
          },
        },
      ]}
    >
      {node}
    </PermissionProvider>
  );
}

async function mount(wrap: Wrap, extra: Record<string, unknown> = {}) {
  const ds = makeDataSource();
  render(
    wrap(
      <PeoplePicker
        open
        objectName="sys_user"
        subtitleFields={SUBTITLE}
        dataSource={ds}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        {...extra}
      />,
    ),
  );
  await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
  return ds;
}

/** Every `$expand` the candidate queries sent (the key's presence, not only its value). */
function expands(ds: any): Array<string[] | undefined> {
  return ds.find.mock.calls.map(([, params]: [string, any]) => params?.$expand);
}

beforeEach(() => {
  // jsdom has no matchMedia; useIsMobile needs it. Default to desktop width.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
});

describe('PeoplePicker — field-level security gates `$expand` (objectui#10373)', () => {
  it('a relation named by a subtitle path that the policy denies is not expanded; the readable one still is', async () => {
    const ds = await mount(denying('primary_business_unit_id'));

    expect(expands(ds)).toEqual([['manager_id']]);
    expect(screen.getByText('Dana Boss · amy@x.io')).toBeTruthy();
    expect(screen.queryByText(/Sales/)).toBeNull();
  });

  it('every relation denied ⇒ no `$expand` key at all', async () => {
    const ds = await mount(denying('primary_business_unit_id', 'manager_id'));

    expect(ds.find).toHaveBeenCalledTimes(1);
    expect('$expand' in ds.find.mock.calls[0][1]).toBe(false);
    expect(screen.getByText('amy@x.io')).toBeTruthy();
  });

  it("a caller's explicit `expand` goes through the same gate", async () => {
    const ds = await mount(denying('primary_business_unit_id'), {
      expand: ['primary_business_unit_id', 'manager_id'],
    });

    expect(expands(ds)).toEqual([['manager_id']]);
  });

  it('control: a readable relation is expanded as before', async () => {
    const ds = await mount(denying('phone'));

    expect(expands(ds)).toEqual([['primary_business_unit_id', 'manager_id']]);
    expect(screen.getByText('Sales · Dana Boss · amy@x.io')).toBeTruthy();
  });

  it('control: with no policy loaded (no provider) nothing is filtered', async () => {
    const ds = await mount(bare);

    expect(expands(ds)).toEqual([['primary_business_unit_id', 'manager_id']]);
    expect(screen.getByText('Sales · Dana Boss · amy@x.io')).toBeTruthy();
  });
});
