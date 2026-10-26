// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (the remainder, item 1) — the permission matrix names its
 * authoring surface only under the Studio host.
 *
 * `PermissionMatrixEditPage` serves two hosts: Studio's Access pillar mounts it
 * with `packageId` and `embedded`, and its draft save is a person's edit in
 * Studio, so it sends `?surface=studio` (recorded as `by: 'studio'` in the
 * draft's `draftChanges`, objectstack#24395). metadata-admin mounts it through
 * the resource registry with only `type` and `name`: its save is the
 * environment door's live write and states no surface.
 *
 * Both hosts are the REAL ones (`AccessPillar`, `MetadataResourceEditPage`
 * through the built-in registration), and the save goes through a REAL
 * `MetadataClient` whose transport records each `PUT`, so the pins read the
 * query string the server would read.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.acme.crm';

const SET = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
};

const puts: URLSearchParams[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The save's transport: records each PUT's query and answers as the door does. */
async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://console.test');
  if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
    puts.push(url.searchParams);
    return json(200, { success: true, version: 'v2', state: url.searchParams.get('mode') ?? 'active' });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const wire = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

/** The reads both hosts make, answered in memory; the save is the real client's. */
const client = {
  list: async (type: string) => {
    if (type === 'permission') return [{ name: SET.name, label: SET.label }];
    if (type === 'object') return [{ name: 'a_account', label: 'Account' }];
    return [];
  },
  listDrafts: async () => [],
  layered: async () => ({ effective: SET, code: null, overlay: null, overlayScope: null }),
  getDraft: async () => null,
  get: async () => null,
  save: (...args: Parameters<MetadataClient['save']>) => wire.save(...args),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));
vi.mock('./AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../studio-design/StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import '../../services/builtinComponents.js';
import { MetadataResourceEditPage } from './ResourceEditPage';
import { AccessPillar } from '../studio-design/StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

/** The shared autosave fires 1.5s after the last edit. */
const AUTOSAVE = { timeout: 4000 };

const readBox = () => screen.getByRole('checkbox', { name: 'a_account Read' });

beforeEach(() => {
  puts.length = 0;
  window.confirm = vi.fn() as unknown as typeof window.confirm;
});
afterEach(cleanup);

describe('the permission matrix states `surface` only under the Studio host (objectui#12725)', () => {
  it('Studio’s Access pillar: the draft save sends `?surface=studio`, once', async () => {
    render(
      <MemoryRouter>
        <AccessPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(readBox()).toBeInTheDocument(), AUTOSAVE);

    fireEvent.click(readBox());
    await waitFor(() => expect(puts).toHaveLength(1), AUTOSAVE);
    expect(puts[0]!.get('mode')).toBe('draft');
    expect(puts[0]!.get('package')).toBe(PKG);
    expect(puts[0]!.getAll('surface')).toEqual(['studio']);
  });

  it('metadata-admin: the environment door’s save sends no `surface`', async () => {
    render(
      <MemoryRouter>
        <MetadataResourceEditPage type="permission" name={SET.name} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(readBox()).toBeInTheDocument(), AUTOSAVE);

    fireEvent.click(readBox());
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    // CONTROL: the edit reached the wire, through the same client and transport.
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.get('mode')).toBeNull();
    expect(puts[0]!.getAll('surface')).toEqual([]);
  });
});
