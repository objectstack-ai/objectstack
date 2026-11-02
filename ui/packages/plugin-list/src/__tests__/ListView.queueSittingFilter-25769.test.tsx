/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack ADR-0142 D3 — the "In a queue" list filter: the records that
 * SIT IN an ownership queue (`owner_id` empty and `queue` named).
 *
 * Pinned:
 *  - the render condition: the toggle appears only when the SERVED object
 *    definition carries the platform-injected `queue` column (`system: true`)
 *    AND the session's `/auth/me/permissions` answer says the organization has
 *    at least one queue (`hasAnyQueue`, objectstack#28428); an object without
 *    the column, or with an author's own non-system `queue` field, gets no
 *    toggle, and neither does any object while `hasAnyQueue` is false or
 *    unknown (no permission provider, or an anonymous answer);
 *  - the cost: the flag rides the permissions answer the session already
 *    holds, so a list mount makes the same data-source calls and no other
 *    request whether or not a queue exists;
 *  - the request: pressing it AND-s exactly `owner_id is_empty` and `queue
 *    is_not_empty` into the fetch filter, and releasing it drops them. Empty is
 *    the server's reading (null OR ''), so the null-only operators are not
 *    used. Nothing about who may see the rows: that stays the server's read
 *    filter.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, screen } from '@testing-library/react';
import { ListView, buildEffectiveFilter, objectHasOwnershipQueue, QUEUE_SITTING_CONDITIONS } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import type { ListViewSchema } from '@object-ui/types';

afterEach(cleanup);

const OBJECT = 'support_ticket';

/** The injected column, as `/meta` serves it on an ownership-queue object. */
const INJECTED_QUEUE = { name: 'queue', type: 'text', system: true, hidden: true };

function dataSourceServing(fields: Record<string, unknown>) {
  return {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, fields: { subject: { name: 'subject', type: 'text' }, ...fields } }),
  };
}

const schema = { type: 'list-view', objectName: OBJECT, fields: ['subject'] } as unknown as ListViewSchema;

/** The session double: the `/auth/me/permissions` answer, serving `hasAnyQueue`. */
function session(hasAnyQueue: boolean): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    hasAnyQueue,
    positions: [],
    permissionSets: ['member_default'],
    objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

/** The organization has a queue unless a test says otherwise. */
const WITH_QUEUE = session(true);

function mount(ds: ReturnType<typeof dataSourceServing>, perms: MePermissionsResponse | null = WITH_QUEUE) {
  const list = <ListView schema={schema} dataSource={ds as any} />;
  return render(
    <SchemaRendererProvider dataSource={ds as any}>
      {perms ? <MePermissionsProvider initialPermissions={perms}>{list}</MePermissionsProvider> : list}
    </SchemaRendererProvider>,
  );
}

/** Settles a mount that renders no toggle: the definition is read and the rows fetched. */
async function settled(ds: ReturnType<typeof dataSourceServing>) {
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
}

const lastFilter = (ds: ReturnType<typeof dataSourceServing>) => {
  const calls = ds.find.mock.calls;
  return (calls[calls.length - 1]?.[1] as { $filter?: unknown } | undefined)?.$filter;
};

describe('objectHasOwnershipQueue — reads the served definition only', () => {
  it('is true for the injected system column, in map or array form', () => {
    expect(objectHasOwnershipQueue({ fields: { queue: INJECTED_QUEUE } })).toBe(true);
    expect(objectHasOwnershipQueue({ fields: [{ name: 'subject' }, INJECTED_QUEUE] })).toBe(true);
  });

  it('is false with no queue column, or an author\'s own non-system one', () => {
    expect(objectHasOwnershipQueue({ fields: { subject: { type: 'text' } } })).toBe(false);
    expect(objectHasOwnershipQueue({ fields: { queue: { name: 'queue', type: 'text' } } })).toBe(false);
    expect(objectHasOwnershipQueue(undefined)).toBe(false);
  });
});

describe('buildEffectiveFilter — the queue conditions are AND-ed like the rest', () => {
  const NONE = { logic: 'and', conditions: [] } as any;

  it('states the platform\'s "sits in": owner empty and queue not empty, null or \'\' alike', () => {
    expect(QUEUE_SITTING_CONDITIONS).toEqual([
      ['owner_id', 'is_empty', true],
      ['queue', 'is_not_empty', true],
    ]);
  });

  it('alone, they are the whole filter', () => {
    expect(buildEffectiveFilter(undefined, NONE, [], QUEUE_SITTING_CONDITIONS)).toEqual([
      'and', ['owner_id', 'is_empty', true], ['queue', 'is_not_empty', true],
    ]);
  });

  it('beside an authored filter, they narrow it', () => {
    expect(buildEffectiveFilter(['status', '=', 'open'], NONE, [], QUEUE_SITTING_CONDITIONS)).toEqual([
      'and', ['status', '=', 'open'], ['owner_id', 'is_empty', true], ['queue', 'is_not_empty', true],
    ]);
  });

  it('absent by default, so every other caller is unchanged', () => {
    expect(buildEffectiveFilter(['status', '=', 'open'], NONE, [])).toEqual(['status', '=', 'open']);
  });
});

describe('ListView "In a queue" toggle (ADR-0142 D3)', () => {
  it('renders on an object served with the injected queue column, and narrows the fetch to parked rows', async () => {
    const ds = dataSourceServing({ queue: INJECTED_QUEUE });
    mount(ds);

    const toggle = await screen.findByTestId('queue-sitting-filter');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toContain('In a queue');
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(JSON.stringify(lastFilter(ds) ?? null)).not.toContain('owner_id');

    const before = ds.find.mock.calls.length;
    fireEvent.click(toggle);
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByTestId('queue-sitting-filter').getAttribute('aria-pressed')).toBe('true');
    expect(lastFilter(ds)).toEqual(['and', ['owner_id', 'is_empty', true], ['queue', 'is_not_empty', true]]);

    const pressed = ds.find.mock.calls.length;
    fireEvent.click(screen.getByTestId('queue-sitting-filter'));
    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(pressed));
    expect(JSON.stringify(lastFilter(ds) ?? null)).not.toContain('owner_id');
  });

  it('does not render on an object without the injected column', async () => {
    const ds = dataSourceServing({ queue: { name: 'queue', type: 'text' } });
    mount(ds);
    await settled(ds);
    expect(screen.queryByTestId('queue-sitting-filter')).toBeNull();
  });
});

describe('ListView "In a queue" toggle — offered only when the organization has a queue (objectstack#28428)', () => {
  it('an organization with no queue: no toggle, even on an object with the injected column', async () => {
    const ds = dataSourceServing({ queue: INJECTED_QUEUE });
    mount(ds, session(false));
    await settled(ds);
    expect(screen.queryByTestId('queue-sitting-filter')).toBeNull();
    expect(JSON.stringify(lastFilter(ds) ?? null)).not.toContain('owner_id');
  });

  it('an organization with one queue: the toggle on the injected column\'s object', async () => {
    const ds = dataSourceServing({ queue: INJECTED_QUEUE });
    mount(ds, session(true));
    expect(await screen.findByTestId('queue-sitting-filter')).toBeTruthy();
  });

  it('an unknown answer hides it: no permission provider, or an anonymous answer', async () => {
    for (const perms of [null, { authenticated: false } as MePermissionsResponse]) {
      const ds = dataSourceServing({ queue: INJECTED_QUEUE });
      const { unmount } = mount(ds, perms);
      await settled(ds);
      expect(screen.queryByTestId('queue-sitting-filter')).toBeNull();
      unmount();
    }
  });

  it('a list mount costs the same calls with and without a queue, and reads no queue list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const calls = async (hasAnyQueue: boolean) => {
        const ds = dataSourceServing({ queue: INJECTED_QUEUE });
        const { unmount } = mount(ds, session(hasAnyQueue));
        await settled(ds);
        if (hasAnyQueue) await screen.findByTestId('queue-sitting-filter');
        const counts = {
          getObjectSchema: ds.getObjectSchema.mock.calls.length,
          find: ds.find.mock.calls.length,
          findOne: ds.findOne.mock.calls.length,
          // Every `find` targets the listed object: no `sys_queue` read.
          resources: [...new Set(ds.find.mock.calls.map((c) => c[0]))],
        };
        unmount();
        return counts;
      };
      const without = await calls(false);
      const withQueue = await calls(true);
      expect(withQueue).toEqual(without);
      expect(without.resources).toEqual([OBJECT]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
