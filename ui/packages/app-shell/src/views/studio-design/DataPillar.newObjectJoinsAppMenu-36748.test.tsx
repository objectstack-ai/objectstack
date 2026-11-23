// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36748 — Studio's 新建对象 adds the new object to the menu of its
 * package's one app, after the object is live: the object's draft and publish,
 * then the app's draft (its stored menu plus the object's entry) and publish.
 * With no app nothing more is written; a refused menu save keeps the object
 * and says so in a warning.
 *
 * The REAL `DataPillar` over a recording client; the package list the menu
 * save reads (`GET /api/v1/packages`) is a fetch stub.
 */

// Warmed at module top so the first load of the console's lazily loaded
// authoring code is paid during collection, not inside a test's clock.
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.test.visits';

const srv = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  appSave: null as null | (() => Promise<unknown>),
  calls: [] as string[],
  appBodies: [] as Array<Record<string, unknown>>,
}));

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? srv.apps : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string) =>
    type === 'app'
      ? { effective: { name: 'visits', label: 'Visits', navigation: [] }, code: null }
      : { effective: null, code: null },
  ),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async (type: string, name: string, body: Record<string, unknown>, options: Record<string, unknown>) => {
    srv.calls.push(`save ${type} ${options.mode}`);
    if (type === 'app') {
      srv.appBodies.push(body);
      if (srv.appSave) return srv.appSave();
    }
    return {};
  }),
  publish: vi.fn(async (type: string) => {
    srv.calls.push(`publish ${type}`);
    return {};
  }),
  reset: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';
import { DataPillar } from './StudioDesignSurface';

beforeEach(() => {
  vi.clearAllMocks();
  srv.apps = [];
  srv.appSave = null;
  srv.calls = [];
  srv.appBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const body =
        path === '/api/v1/packages'
          ? { success: true, data: [{ manifest: { id: PKG, name: 'Visits', version: '0.1.0' }, writable: true }] }
          : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function createObject(label: string) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId('empty-state-new-object'));
  await screen.findByTestId('create-object-owd');
  const dialog = screen.getByRole('dialog');
  fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: label } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^(create|创建)$/i }));
}

/** The object's name, as its draft was saved. */
const objectName = () => String(mockClient.save.mock.calls.find((c) => c[0] === 'object')?.[1]);

describe('新建对象 joins the package’s one app menu (objectstack#36748)', () => {
  it('the object goes live, then the app’s menu gains its entry and is published', async () => {
    srv.apps = [{ name: 'visits', label: 'Visits' }];
    await createObject('Visit');
    await waitFor(() =>
      expect(srv.calls).toEqual(['save object draft', 'publish object', 'save app draft', 'publish app']),
    );
    expect(srv.appBodies[0]?.navigation).toEqual([
      { id: `nav_${objectName()}`, type: 'object', objectName: objectName() },
    ]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('a package with no app: only the object is written', async () => {
    await createObject('Visit');
    await waitFor(() => expect(srv.calls).toEqual(['save object draft', 'publish object']));
    // Settled: the create finished and asked for the package's apps.
    await waitFor(() => expect(mockClient.list).toHaveBeenCalledWith('app', { packageId: PKG }));
    expect(srv.calls).toEqual(['save object draft', 'publish object']);
  });

  it('a refused menu save keeps the object and says so in a warning', async () => {
    srv.apps = [{ name: 'visits', label: 'Visits' }];
    srv.appSave = () => Promise.reject(Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' }));
    await createObject('Visit');
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/“Visit” was created, but .*“Visits”/)));
    expect(srv.calls).toEqual(['save object draft', 'publish object', 'save app draft']);
    // The object is open on the rail all the same.
    expect(await screen.findByTestId('form-toolbar')).toBeInTheDocument();
  });
});
