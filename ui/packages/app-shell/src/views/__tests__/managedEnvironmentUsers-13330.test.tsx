// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13330 — the read behind Setup → Users' 「未授权」 marker on a managed
 * environment: what "beyond the baseline" means, read from the server's grant
 * rows, and the cases where the answer is unknown and the user stays unmarked.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  UnauthorizedUserMarker,
  UserGrantLoader,
  isGrantActive,
  isManagedEnvironment,
  readUserGrantStates,
} from '../managedEnvironmentUsers';

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

const POSITIONS = [
  { name: 'everyone', permissionSets: ['member_default', 'accepted_default'] },
  { name: 'guest', permissionSets: ['guest_read'] },
  { name: 'sales_rep', permissionSets: ['sales'] },
  { name: 'greeter', permissionSets: ['member_default'] },
  // Lists only a baseline set, and shares its name with a set that exists.
  { name: 'closer', permissionSets: ['member_default'] },
];
const PERMISSION_SETS = ['member_default', 'accepted_default', 'guest_read', 'sales', 'closer'].map((name) => ({ name }));

function sourceOf(grants: unknown, assignments: unknown) {
  return {
    find: vi.fn(async (resource: string, _params?: Record<string, unknown>) =>
      resource === 'sys_user_permission_set' ? grants : assignments,
    ),
  };
}
const registry = {
  ensureType: vi.fn(async (type: string) => (type === 'position' ? POSITIONS : type === 'permission' ? PERMISSION_SETS : [])),
  getTypeStatus: () => 'ready',
};

afterEach(() => cleanup());

describe('isManagedEnvironment', () => {
  it('is true only for a served `cloudManaged: true`', () => {
    expect(isManagedEnvironment({ cloudManaged: true })).toBe(true);
    for (const features of [undefined, null, {}, { cloudManaged: false }, { cloudManaged: 'true' }]) {
      expect(isManagedEnvironment(features as never)).toBe(false);
    }
  });
});

describe('isGrantActive — the half-open window the server enforces', () => {
  it('an open window is active', () => {
    expect(isGrantActive({}, NOW)).toBe(true);
  });
  it('a grant that starts later is not active yet; one that started at now is', () => {
    expect(isGrantActive({ valid_from: NOW + 1 }, NOW)).toBe(false);
    expect(isGrantActive({ valid_from: NOW }, NOW)).toBe(true);
  });
  it('a grant that ends at now has ended', () => {
    expect(isGrantActive({ valid_until: NOW }, NOW)).toBe(false);
    expect(isGrantActive({ valid_until: NOW + 1 }, NOW)).toBe(true);
  });
  it('a bound that does not parse reads as active (uncertain is not nothing)', () => {
    expect(isGrantActive({ valid_until: 'not a date' }, NOW)).toBe(true);
  });
});

describe('readUserGrantStates', () => {
  it('a direct grant of a set the anchor does not list is beyond the baseline', async () => {
    const states = await readUserGrantStates(
      sourceOf({ data: [{ user_id: 'u1', permission_set: 'sales' }] }, { data: [] }),
      registry,
      ['u1', 'u2'],
      NOW,
    );
    expect(states.get('u1')).toBe('beyond-baseline');
    expect(states.get('u2')).toBe('baseline-only');
  });

  it('a grant of a baseline set, or one whose window is not open now, is not', async () => {
    const states = await readUserGrantStates(
      sourceOf(
        {
          data: [
            { user_id: 'u1', permission_set: 'accepted_default' },
            { user_id: 'u2', permission_set: 'sales', valid_until: NOW - 1 },
            { user_id: 'u3', permission_set: 'sales', valid_from: NOW + 1 },
          ],
        },
        { data: [] },
      ),
      registry,
      ['u1', 'u2', 'u3'],
      NOW,
    );
    expect([...states.values()]).toEqual(['baseline-only', 'baseline-only', 'baseline-only']);
  });

  it('a position counts by the sets its registry definition lists; the anchors never do', async () => {
    const states = await readUserGrantStates(
      sourceOf(
        { data: [] },
        {
          data: [
            { user_id: 'u1', position: 'sales_rep' },
            { user_id: 'u2', position: 'greeter' },
            { user_id: 'u3', position: 'guest' },
            { user_id: 'u4', position: 'sales_rep', valid_until: NOW - 1 },
          ],
        },
      ),
      registry,
      ['u1', 'u2', 'u3', 'u4'],
      NOW,
    );
    expect(states.get('u1')).toBe('beyond-baseline');
    expect(states.get('u2')).toBe('baseline-only');
    // `guest` lists a set the `everyone` anchor does not, and still says nothing of the user.
    expect(states.get('u3')).toBe('baseline-only');
    expect(states.get('u4')).toBe('baseline-only');
  });

  it('a position counts the set of its own name, though its definition does not list it (the name fold)', async () => {
    const states = await readUserGrantStates(
      sourceOf(
        { data: [] },
        { data: [{ user_id: 'u1', position: 'closer' }, { user_id: 'u2', position: 'greeter' }] },
      ),
      registry,
      ['u1', 'u2'],
      NOW,
    );
    // The server grants holders of `closer` the `closer` set (objectstack-ai/objectstack#24757).
    expect(states.get('u1')).toBe('beyond-baseline');
    // No set is named `greeter`: nothing folds.
    expect(states.get('u2')).toBe('baseline-only');
  });

  it('a position held while the permission-set catalogue cannot be read leaves its user unknown', async () => {
    const refused = {
      ensureType: vi.fn(async (type: string) => (type === 'position' ? POSITIONS : [])),
      getTypeStatus: (type: string) => (type === 'permission' ? 'error' : 'ready'),
    };
    const states = await readUserGrantStates(
      sourceOf(
        { data: [{ user_id: 'u3', permission_set: 'sales' }] },
        { data: [{ user_id: 'u1', position: 'greeter' }] },
      ),
      refused,
      ['u1', 'u2', 'u3'],
      NOW,
    );
    expect(states.get('u1')).toBe('unknown');
    // A user who holds no position and no grant row holds the baseline, catalogue or not.
    expect(states.get('u2')).toBe('baseline-only');
    expect(states.get('u3')).toBe('beyond-baseline');
  });

  it('a position the registry does not define leaves its user unknown', async () => {
    const states = await readUserGrantStates(
      sourceOf({ data: [] }, { data: [{ user_id: 'u1', position: 'retired_position' }] }),
      registry,
      ['u1', 'u2'],
      NOW,
    );
    expect(states.get('u1')).toBe('unknown');
    expect(states.get('u2')).toBe('baseline-only');
  });

  it.each([
    ['hasMore', { data: [{ user_id: 'u1', permission_set: 'member_default' }], hasMore: true }],
    ['a total longer than the page', { data: [{ user_id: 'u1', permission_set: 'member_default' }], total: 1001 }],
  ])('a grant answer the server reports as cut short (%s) leaves every user it did not mark unknown', async (_l, grants) => {
    const states = await readUserGrantStates(
      sourceOf(grants, { data: [{ user_id: 'u3', position: 'sales_rep' }] }),
      registry,
      ['u1', 'u2', 'u3'],
      NOW,
    );
    expect(states.get('u1')).toBe('unknown');
    expect(states.get('u2')).toBe('unknown');
    // A grant it did read still counts.
    expect(states.get('u3')).toBe('beyond-baseline');
  });

  it('asks each object once, by user', async () => {
    const source = sourceOf({ data: [] }, { data: [] });
    await readUserGrantStates(source, registry, ['u1', 'u2'], NOW);
    expect(source.find.mock.calls.map(([r]) => r).sort()).toEqual(['sys_user_permission_set', 'sys_user_position']);
    for (const [, params] of source.find.mock.calls) {
      expect(params).toMatchObject({ $filter: { user_id: { $in: ['u1', 'u2'] } } });
    }
  });

  it('rejects when a read is refused', async () => {
    const source = { find: vi.fn(async () => { throw new Error('403'); }) };
    await expect(readUserGrantStates(source, registry, ['u1'], NOW)).rejects.toThrow('403');
  });
});

describe('UnauthorizedUserMarker', () => {
  async function mountMarkers(source: { find: (...a: any[]) => Promise<unknown> }, ids: string[]) {
    const loader = new UserGrantLoader(source, registry);
    const t = (key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? key);
    render(
      <>
        {ids.map((id) => (
          <div key={id} data-testid={`row-${id}`}>
            <UnauthorizedUserMarker loader={loader} userId={id} t={t} />
          </div>
        ))}
      </>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it('draws 「未授权」 for a user with nothing beyond the baseline, and nothing for one with a grant', async () => {
    const source = {
      find: vi.fn(async (resource: string) =>
        resource === 'sys_user_permission_set' ? { data: [{ user_id: 'u2', permission_set: 'sales' }] } : { data: [] },
      ),
    };
    await mountMarkers(source, ['u1', 'u2']);
    expect(screen.getByTestId('row-u1')).toHaveTextContent('Not authorized');
    expect(screen.getByTestId('row-u2')).toBeEmptyDOMElement();
    // Every marker the render committed is answered by one read per object.
    expect(source.find).toHaveBeenCalledTimes(2);
  });

  it('draws nothing when the read is refused: unknown is never "not authorized"', async () => {
    const source = { find: vi.fn(async () => { throw new Error('403'); }) };
    await mountMarkers(source, ['u1']);
    expect(screen.getByTestId('row-u1')).toBeEmptyDOMElement();
  });
});
