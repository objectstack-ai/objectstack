// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29121 — Home asks for the objects it names, never the whole
 * object registry.
 *
 * Measured on `main` (app-crm, production Console, CDP initiator stacks): every
 * visit to `/home` read `GET /api/v1/meta/object` (the whole registry, ~875 KB
 * on HotCRM) and `GET /api/v1/meta/view`, from four readers, each hidden behind
 * the one before it by the provider's cache: the closed command palette's
 * `objects` prop (`HomeLayout`), the activity feeds' `sys_activity` presence
 * check (`useObjectPresence`) and their cross-app roster's capability gate
 * (`useNavMemberGates`), both outside an app, and the recent rows' icons
 * (`HomePage`). Two more read it once there is data: a recent record row's
 * object label (`useNavTargetLabel`) and an activity row's
 * (`ActivityObjectLabel`).
 *
 * These cases count the reads the REAL `MetadataProvider` sends to a fake
 * adapter, outside an app, for each hook reader: the names each asks for, by
 * name, and neither list. The CONTROL: once the whole list is loaded, a reader
 * reads it and asks nothing. `HomeLayout`'s palette and `HomePage`'s recent
 * rows are counted in their own files (`HomeLayout.paletteReads-29121`,
 * `HomePage.recentObjectReads-29121`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MetadataProvider, useMetadata } from '../../../providers/MetadataProvider';
import { readObjectsByName, useObjectPresence } from '../../../hooks/useObjectPresence';
import { useNavMemberGates } from '../../../hooks/useNavMemberGates';
import { ActivityObjectLabel } from '../../../layout/ActivityObjectLabel';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ language: 'en', t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string }) => String(x?.label || '');
    return { objectLabel: label, dashboardLabel: label, viewLabel: (_o: string, _v: string, f?: string) => f ?? '' };
  },
}));

const OBJECTS = [
  { name: 'crm_account', label: 'Account', _packageId: 'app.crm', fields: {} },
  { name: 'sys_activity', label: 'Activity', _packageId: 'plugin.audit', fields: {} },
  { name: 'sys_queue', label: 'Queue', _packageId: 'plugin.setup', fields: {} },
];

const APPS = [
  { name: 'crm', _packageId: 'app.crm', navigation: [{ id: 'a', type: 'object', objectName: 'crm_account' }] },
  {
    name: 'setup',
    _packageId: 'plugin.setup',
    navigation: [
      { id: 'q', type: 'object', objectName: 'sys_queue', requiresObject: 'sys_queue' },
      { id: 'x', type: 'object', objectName: 'sys_cloud_only', requiresObject: 'sys_cloud_only' },
    ],
  },
];

function makeAdapter(calls: string[]) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'app' ? APPS : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name) ?? null;
          return Promise.resolve({ item: structuredClone(item) });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** Object and view reads, in the order they were sent. */
const metaReads = (calls: string[]) =>
  calls.filter((c) => c === 'object' || c === 'view' || c.startsWith('object?') || c.startsWith('object/'));

function mount(children: React.ReactNode): string[] {
  const calls: string[] = [];
  render(<MetadataProvider adapter={makeAdapter(calls)}>{children}</MetadataProvider>);
  return calls;
}

function PresenceProbe({ name }: { name: string }) {
  const { presence, settled } = useObjectPresence(name);
  return <output data-testid="presence" data-presence={presence} data-settled={String(settled)} />;
}

function GateProbe() {
  const { apps } = useMetadata();
  const gates = useNavMemberGates();
  if (!apps.length) return null;
  return (
    <output
      data-testid="gate"
      data-queue={String(gates.checkCapability('object', 'sys_queue'))}
      data-cloud={String(gates.checkCapability('object', 'sys_cloud_only'))}
    />
  );
}

/** Loads the whole registry, as a route that needs it does, then renders `children`. */
function WholeListFirst({ children }: { children: React.ReactNode }) {
  const metadata = useMetadata();
  const loaded = metadata.objects.length > 0 && metadata.getTypeStatus?.('object') === 'ready';
  return loaded ? <>{children}</> : null;
}

function ByNameProbe({ names }: { names: string[] }) {
  const metadata = useMetadata();
  const found = readObjectsByName(metadata, names) as Array<{ name?: string }>;
  return <output data-testid="by-name" data-names={found.map((o) => o?.name).join(',')} />;
}

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('Home asks for the objects it names, never the whole registry (objectstack#29121)', () => {
  it('outside an app, the activity feeds’ presence check asks for its one object by name', async () => {
    const calls = mount(<PresenceProbe name="sys_activity" />);
    await waitFor(() => expect(screen.getByTestId('presence')).toHaveAttribute('data-presence', 'present'));
    await settle();
    expect(metaReads(calls)).toEqual(['object/sys_activity']);
  });

  it('outside an app, the roster’s capability gate asks the app list’s required objects by name, and answers as the whole list did', async () => {
    const calls = mount(<GateProbe />);
    await waitFor(() => expect(screen.getByTestId('gate')).toHaveAttribute('data-cloud', 'false'));
    expect(screen.getByTestId('gate')).toHaveAttribute('data-queue', 'true');
    await settle();
    expect([...metaReads(calls)].sort()).toEqual(['object/sys_cloud_only', 'object/sys_queue']);
  });

  it('an activity row names its object from a read of that object alone', async () => {
    const calls = mount(<ActivityObjectLabel objectName="crm_account" />);
    await waitFor(() => expect(document.body).toHaveTextContent('Account'));
    await settle();
    expect(metaReads(calls)).toEqual(['object/crm_account']);
  });

  it('CONTROL — with the whole list loaded, each reader reads it and asks for nothing more', async () => {
    const calls = mount(
      <WholeListFirst>
        <PresenceProbe name="sys_activity" />
        <GateProbe />
        <ActivityObjectLabel objectName="crm_account" />
        <ByNameProbe names={['crm_account']} />
      </WholeListFirst>,
    );
    // Something else asked for the whole list: `WholeListFirst` reads `objects`.
    await waitFor(() => expect(screen.getByTestId('by-name')).toHaveAttribute('data-names', 'crm_account,sys_activity,sys_queue'));
    expect(screen.getByTestId('presence')).toHaveAttribute('data-presence', 'present');
    expect(screen.getByTestId('gate')).toHaveAttribute('data-cloud', 'false');
    expect(document.body).toHaveTextContent('Account');
    await settle();
    expect(metaReads(calls)).toEqual(['object', 'view']);
  });

  it('asking for no name asks for nothing (a names-only scope with no names would be the whole list)', async () => {
    const calls = mount(<ByNameProbe names={[]} />);
    await settle();
    expect(screen.getByTestId('by-name')).toHaveAttribute('data-names', '');
    expect(metaReads(calls)).toEqual([]);
  });
});
