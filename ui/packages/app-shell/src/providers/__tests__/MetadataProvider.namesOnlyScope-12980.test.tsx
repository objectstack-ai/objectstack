// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — `readObjectScope({ names })` with no `packageId` is a
 * names-only scope: each name read by name (`GET meta/object/NAME`), no
 * package list, never the whole registry. A page route in an app item without
 * a package reads its page's objects through it.
 *
 * What these pins hold:
 *
 *   - a names-only scope asks each name by name, and nothing else;
 *   - it is `settled` once every name has answered, and a name the server
 *     does not answer is `missing`;
 *   - with the whole registry already loaded it is cut from it, asking nothing;
 *   - a refresh asks its names again, and no package list;
 *   - CONTROL: no `packageId` and no `names` (or an empty list) is still the
 *     whole registry, as the contract says.
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

describe('MetadataProvider.readObjectScope, the names-only scope (objectui#12980)', () => {
  it('asks each name by name, never the package list or the whole registry', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      m.ctx().readObjectScope!({ names: ['crm_case', 'sys_user'] });
    });
    await waitFor(() => expect(m.ctx().readObjectScope!({ names: ['crm_case', 'sys_user'] }).settled).toBe(true));

    const scope = m.ctx().readObjectScope!({ names: ['crm_case', 'sys_user'] });
    expect(names(scope.objects)).toEqual(['crm_case', 'sys_user']);
    expect([...objectCalls(m.server.calls)].sort()).toEqual(['object/crm_case', 'object/sys_user']);
    expect(m.ctx().getTypeStatus!('object')).toBe('idle');
    // Shaped as in the whole list: the view is merged onto its object.
    expect(byName(scope.objects, 'crm_case')).toHaveProperty('listViews');
  });

  it('is not settled until every name answers, and lists a name the server does not answer as missing', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    m.server.holdByName = true;
    act(() => {
      m.ctx().readObjectScope!({ names: ['crm_case', 'no_such_object'] });
    });
    expect(m.ctx().readObjectScope!({ names: ['crm_case', 'no_such_object'] }).settled).toBe(false);
    act(() => m.server.release());
    await waitFor(() => expect(m.ctx().readObjectScope!({ names: ['crm_case', 'no_such_object'] }).settled).toBe(true));
    const scope = m.ctx().readObjectScope!({ names: ['crm_case', 'no_such_object'] });
    expect(scope.missing).toEqual(['no_such_object']);
    expect(names(scope.objects)).toEqual(['crm_case']);
  });

  it('with the whole registry loaded, is cut from it and asks for nothing', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      void m.ctx().ensureType('object');
    });
    await waitFor(() => expect(m.ctx().getTypeStatus!('object')).toBe('ready'));
    const before = objectCalls(m.server.calls).length;
    let scope: ReturnType<NonNullable<Ctx['readObjectScope']>> | undefined;
    act(() => {
      scope = m.ctx().readObjectScope!({ names: ['sys_user'] });
    });
    expect(scope!.settled).toBe(true);
    expect(names(scope!.objects)).toEqual(['sys_user']);
    expect(objectCalls(m.server.calls).length).toBe(before);
  });

  it('a refresh asks its names again, and no package list', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      m.ctx().readObjectScope!({ names: ['crm_case'] });
    });
    await waitFor(() => expect(m.ctx().readObjectScope!({ names: ['crm_case'] }).settled).toBe(true));
    m.server.calls = [];
    await act(async () => {
      await m.ctx().refresh('object');
    });
    expect(objectCalls(m.server.calls)).toContain('object/crm_case');
    expect(objectCalls(m.server.calls).some((c) => c.startsWith('object?'))).toBe(false);
  });

  it('CONTROL: no package id and no names is the whole registry, and so is an empty names list', async () => {
    const m = mount();
    await waitFor(() => expect(m.server.calls).toContain('view'));
    act(() => {
      m.ctx().readObjectScope!({ names: [] });
    });
    await waitFor(() => expect(m.ctx().readObjectScope!({}).settled).toBe(true));
    expect(objectCalls(m.server.calls)).toEqual(['object']);
    expect(names(m.ctx().readObjectScope!({}).objects)).toEqual(['crm_account', 'crm_case', 'crm_contact', 'sys_user']);
  });
});
