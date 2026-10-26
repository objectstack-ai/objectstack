// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12811 — `readObjectScope`, the object read one app needs.
 *
 * Measured before this card: every console open asked `GET
 * /api/v1/meta/object` for the whole registry (97 objects, 745 KB on the
 * card's backend), because the readers on the open path read `objects`.
 * `readObjectScope({ packageId, names })` asks for the package's objects
 * (`?package=`, the list door's declared scope, ADR-0048) and for each named
 * object outside the package by name.
 *
 * What these pins hold:
 *
 *   - a scope asks `object?package=ID` and never the bare `object` list;
 *   - a name outside the package is asked by name, after the package list has
 *     answered without it, and the scope is not `settled` until it answers;
 *   - a scoped definition is shaped exactly like the same object in `objects`
 *     (views merged, references normalized);
 *   - a name the server does not answer is `missing`, and settles;
 *   - CONTROL: `objects` is still the whole registry, and a scope with no
 *     package id is the whole registry too;
 *   - the scope is dropped and refetched with the `object` type (`invalidate`,
 *     `refresh`), never on a clock;
 *   - with the whole registry already loaded, a scope asks for nothing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

type Ctx = ReturnType<typeof useMetadata>;
type Def = { name: string; _packageId?: string; fields?: Record<string, any>; listViews?: Record<string, unknown> };

const CRM = 'app.crm';
const OBJECTS: Def[] = [
  {
    name: 'crm_account',
    _packageId: CRM,
    // A legacy spelling: ingestion folds it onto `reference` on both paths.
    fields: { name: { type: 'text' }, owner: { type: 'lookup', reference_to: 'sys_user' } },
  },
  { name: 'crm_contact', _packageId: CRM, fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'crm_case', _packageId: 'app.service', fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: { name: { type: 'text' } } },
];
const VIEWS = [
  { name: 'crm_account.all', object: 'crm_account', viewKind: 'list', label: 'All', isDefault: true, config: { type: 'grid', columns: ['name'] } },
  { name: 'crm_case.all', object: 'crm_case', viewKind: 'list', label: 'All', isDefault: true, config: { type: 'grid', columns: ['account'] } },
];

interface Server {
  calls: string[];
  /** Holds every by-name answer until released, when set. */
  holdByName: boolean;
  release: () => void;
}

/** Serves the list door with `?package=` and the by-name door, recording each call as its URL would read. */
function makeAdapter(server: Server) {
  const held: Array<() => void> = [];
  server.release = () => held.splice(0).forEach((go) => go());
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // objectui#13044 — the provider's by-name OBJECT read goes through the
    // adapter's `getObjectSchema`. This double answers it from the same
    // by-name door, unwrapped the way the adapter unwraps it.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          server.calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'view' ? VIEWS : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          server.calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          const answer = () =>
            item ? Promise.resolve({ type, name, item: structuredClone(item) }) : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
          if (!server.holdByName) return answer();
          return new Promise((resolve, reject) => held.push(() => answer().then(resolve, reject)));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function mount() {
  const server: Server = { calls: [], holdByName: false, release: () => {} };
  let latest: Ctx | null = null;
  function Probe() {
    latest = useMetadata();
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(server)}>
      <Probe />
    </MetadataProvider>,
  );
  return { server, ctx: () => latest as unknown as Ctx };
}

const objectCalls = (calls: string[]) => calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));
const names = (list: unknown[]) => (list as Def[]).map((o) => o.name).sort();
const byName = (list: unknown[], name: string) => (list as Def[]).find((o) => o.name === name);

afterEach(() => cleanup());

describe('MetadataProvider.readObjectScope (objectui#12811)', () => {
  it("asks for the package's objects with `?package=`, never the whole list", async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      m.ctx().readObjectScope!({ packageId: CRM });
    });
    await waitFor(() => expect(m.ctx().readObjectScope!({ packageId: CRM }).settled).toBe(true));

    const scope = m.ctx().readObjectScope!({ packageId: CRM });
    expect(names(scope.objects)).toEqual(['crm_account', 'crm_contact']);
    expect(scope.missing).toEqual([]);
    expect(objectCalls(m.server.calls)).toEqual([`object?package=${CRM}`]);
    expect(m.ctx().getTypeStatus!('object')).toBe('idle');
    // The same list for the same stored inputs, read after read (objectui#11699).
    expect(m.ctx().readObjectScope!({ packageId: CRM }).objects).toBe(scope.objects);
  });

  it('asks an object outside the package by name, and is not settled until it answers', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    m.server.holdByName = true;
    act(() => {
      m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_account', 'crm_case'] });
    });
    // The package list answers first; only then is the name it lacks asked, by
    // the next read (a reader re-renders when the list lands).
    await waitFor(() => {
      m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_account', 'crm_case'] });
      expect(m.server.calls).toContain('object/crm_case');
    });
    expect(objectCalls(m.server.calls)).toEqual([`object?package=${CRM}`, 'object/crm_case']);
    const waiting = m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_account', 'crm_case'] });
    expect(waiting.settled).toBe(false);
    expect(byName(waiting.objects, 'crm_case')).toBeUndefined();

    act(() => m.server.release());
    await waitFor(() => expect(m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_case'] }).settled).toBe(true));
    const scope = m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_case'] });
    expect(names(scope.objects)).toEqual(['crm_account', 'crm_case', 'crm_contact']);
    // Asked once: a second read with the same name asks nothing more.
    expect(objectCalls(m.server.calls)).toEqual([`object?package=${CRM}`, 'object/crm_case']);
  });

  it('shapes a scoped definition exactly like the same object in the whole list', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_case'] });
    });
    await waitFor(() => expect(m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_case'] }).settled).toBe(true));
    const scoped = m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_case'] }).objects;

    act(() => {
      void m.ctx().objects;
    });
    await waitFor(() => expect(m.ctx().objects).toHaveLength(OBJECTS.length));
    const whole = m.ctx().objects;
    for (const name of ['crm_account', 'crm_contact', 'crm_case']) {
      expect(byName(scoped, name)).toEqual(byName(whole, name));
    }
    expect(byName(scoped, 'crm_account')?.listViews?.['crm_account.all']).toBeTruthy();
    expect(byName(scoped, 'crm_case')?.listViews?.['crm_case.all']).toBeTruthy();
    expect(byName(scoped, 'crm_account')?.fields?.owner.reference).toBe('sys_user');
  });

  it('lists a name the server does not answer as missing, and settles', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      m.ctx().readObjectScope!({ packageId: CRM, names: ['cloud_only'] });
    });
    await waitFor(() => expect(m.ctx().readObjectScope!({ packageId: CRM, names: ['cloud_only'] }).settled).toBe(true));
    expect(m.ctx().readObjectScope!({ packageId: CRM, names: ['cloud_only'] }).missing).toEqual(['cloud_only']);
  });

  it('CONTROL: `objects` is still the whole registry, and so is a scope with no package id', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      void m.ctx().objects;
    });
    await waitFor(() => expect(m.ctx().objects).toHaveLength(OBJECTS.length));
    expect(names(m.ctx().objects)).toEqual(names(OBJECTS));
    expect(objectCalls(m.server.calls)).toEqual(['object']);

    const noPackage = m.ctx().readObjectScope!({});
    expect(noPackage.objects).toBe(m.ctx().objects);
    expect(noPackage.settled).toBe(true);
  });

  it('with the whole registry loaded, a scope is cut from it and asks for nothing', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      void m.ctx().objects;
    });
    await waitFor(() => expect(m.ctx().getTypeStatus!('object')).toBe('ready'));
    const scope = m.ctx().readObjectScope!({ packageId: CRM, names: ['sys_user', 'cloud_only'] });
    expect(scope.settled).toBe(true);
    expect(names(scope.objects)).toEqual(['crm_account', 'crm_contact', 'sys_user']);
    expect(scope.missing).toEqual(['cloud_only']);
    expect(objectCalls(m.server.calls)).toEqual(['object']);
  });

  it('is dropped and refetched with the `object` type, never on a clock', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    const read = () => m.ctx().readObjectScope!({ packageId: CRM, names: ['crm_case'] });
    act(() => {
      read();
    });
    await waitFor(() => expect(read().settled).toBe(true));
    m.server.calls.length = 0;

    // A by-name invalidation drops that definition; the next read asks it again.
    act(() => m.ctx().invalidate('object', 'crm_case'));
    expect(byName(read().objects, 'crm_case')).toBeUndefined();
    await waitFor(() => expect(byName(read().objects, 'crm_case')).toBeTruthy());
    expect(objectCalls(m.server.calls)).toEqual(['object/crm_case']);

    // `refresh` refetches the package list and the name in place: the items
    // stay readable while the answers are in flight.
    m.server.calls.length = 0;
    m.server.holdByName = true;
    let refreshed: Promise<void> | null = null;
    act(() => {
      refreshed = m.ctx().refresh('object');
    });
    expect(byName(read().objects, 'crm_case')).toBeTruthy();
    expect(read().settled).toBe(true);
    act(() => m.server.release());
    await act(async () => {
      await refreshed;
    });
    expect(objectCalls(m.server.calls).sort()).toEqual(['object', `object?package=${CRM}`, 'object/crm_case'].sort());
    m.server.holdByName = false;

    // A whole-type invalidation drops the scope; the next read starts again.
    m.server.calls.length = 0;
    act(() => m.ctx().invalidate('object'));
    act(() => {
      read();
    });
    await waitFor(() => expect(read().settled).toBe(true));
    expect(objectCalls(m.server.calls)).toEqual([`object?package=${CRM}`, 'object/crm_case']);
  });
});
