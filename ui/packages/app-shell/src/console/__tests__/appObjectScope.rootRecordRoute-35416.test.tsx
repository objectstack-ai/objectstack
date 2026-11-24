// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35416 — the console root starts a record route's reads.
 *
 * `AppContent` mounts below the session's permission read (`/auth/me/permissions`),
 * so the page list and the package object list a record route waits for used
 * to leave one round trip after that read answered. The root's prefetch
 * (`useAppObjectScopePrefetch`, mounted beside the permission read) now asks
 * them as soon as the app list names the app: the page list on every record
 * route, and the package list beside it under the same rule `AppContent`
 * follows (objectstack#35455: not when the bundle answers a miss).
 *
 * Only the root's prefetch is mounted here, so every read below is one the
 * root asked before `AppContent` exists.
 *
 * CONTROLs: an object's list route asks no page list; a bundle that is a miss
 * starts no package list beside the page list.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { useAppObjectScopePrefetch } from '../appObjectScope';

const CRM = 'app.crm';
const APPS = [{ name: 'crm', _packageId: CRM, navigation: [] }];
const OBJECTS = [{ name: 'crm_account', _packageId: CRM, fields: {} }];

type Adapter = Parameters<typeof MetadataProvider>[0]['adapter'];

/** Every metadata read is held until `release`; `pending` names the held ones. */
function makeHeldAdapter(options: { bundleOnTheWire: boolean }) {
  const held: Array<{ label: string; go: () => void }> = [];
  const hold = <T,>(label: string, answer: () => T) =>
    new Promise<T>((resolve) => held.push({ label, go: () => resolve(answer()) }));
  const list = (type: string, packageId?: string) => {
    const all: any[] = type === 'app' ? APPS : type === 'object' ? OBJECTS : [];
    return { type, items: structuredClone(packageId ? all.filter((o) => o._packageId === packageId) : all) };
  };
  const adapter = {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    getObjectSchema: (name: string) => hold(`object/${name}`, () => OBJECTS.find((o) => o.name === name)),
    getClient: () => ({
      meta: {
        getItems: (type: string, opts?: { packageId?: string; names?: readonly string[] }) =>
          hold(
            opts?.names ? `${type}?names=${opts.names.join(',')}` : opts?.packageId ? `${type}?package=${opts.packageId}` : type,
            () => list(type, opts?.packageId),
          ),
        getItem: (type: string, name: string) => hold(`${type}/${name}`, () => ({ item: undefined })),
      },
    }),
    // A bundle still on the wire: the provider answers its reads `pending`.
    ...(options.bundleOnTheWire
      ? { peekAppBundle: () => ({ status: 'loading', settled: new Promise(() => undefined) }) }
      : {}),
  } as unknown as Adapter;
  return { adapter, pending: () => held.map((h) => h.label).sort(), release: () => held.splice(0).forEach((h) => h.go()) };
}

function RootPrefetch() {
  useAppObjectScopePrefetch();
  return null;
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

/** The reads the root asks in each wave, for `waveCount` waves. */
async function rootWaves(url: string, bundleOnTheWire: boolean, waveCount = 2): Promise<string[][]> {
  sessionStorage.clear();
  const transport = makeHeldAdapter({ bundleOnTheWire });
  render(
    <MetadataProvider adapter={transport.adapter}>
      <MemoryRouter initialEntries={[url]}>
        <RootPrefetch />
      </MemoryRouter>
    </MetadataProvider>,
  );
  const seen: string[][] = [];
  await settle();
  for (let i = 0; i < waveCount; i++) {
    seen.push(transport.pending());
    transport.release();
    await settle();
  }
  return seen;
}

afterEach(() => cleanup());

describe('objectstack#35416 — the console root starts a record route\'s reads', () => {
  it('a record route: the app list, then the page list and the package list together, before AppContent mounts', async () => {
    const [first, second] = await rootWaves('/apps/crm/crm_account/record/r1', true);
    expect(first).toEqual(['app']);
    expect(second).toEqual(expect.arrayContaining(['page', `object?package=${CRM}`]));
  });

  it("CONTROL: a bundle that is a miss starts the page list alone, as AppContent's rule says (objectstack#35455)", async () => {
    const [first, second] = await rootWaves('/apps/crm/crm_account/record/r1', false);
    expect(first).toEqual(['app']);
    expect(second).toContain('page');
    expect(second).not.toContain(`object?package=${CRM}`);
  });

  it("CONTROL: an object's list route asks no page list at the root", async () => {
    const waves = await rootWaves('/apps/crm/crm_account', true, 3);
    expect(waves.flat()).not.toContain('page');
    expect(waves[1]).toContain(`object?package=${CRM}`);
  });
});
