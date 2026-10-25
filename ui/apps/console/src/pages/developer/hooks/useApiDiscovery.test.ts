// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useApiDiscovery — service-gated endpoint groups (#4240, #5286, #5291).
 *
 * ## The defect #4240 pinned, and where #9683 left it
 *
 * `SERVICE_ENDPOINT_CATALOG` keys are looked up in `/discovery`'s `services`
 * map, which the framework keys by `CoreServiceName`. #4240 fixed a mis-key
 * (the storage group was keyed by its route while the slot was spelled
 * differently). A miss here is indistinguishable from "no such service" —
 * the deliberate fail-closed branch (ADR-0076 D12) then hides the group
 * everywhere, on every deployment, silently.
 *
 * The framework's #9683 ruling (2026-08-18) made `storage` the canonical
 * slot and kept `file-storage` as a deprecated v17 alias, which both
 * discovery producers fill with a byte-equal copy of the `storage` row.
 * #5286 bridged the two spellings on this side while the installed spec
 * enum still lacked `storage`; #5291 re-keyed the catalog to `storage` and
 * removed that bridge. The page now reads the canonical key and nothing
 * else — pinned below in both directions.
 *
 * ## What is asserted, and why the gate is left real
 *
 * `isServiceUsable` (`@object-ui/react`) is NOT stubbed here — it is the
 * contract under test on the "hidden" cases, and a transcription of it would
 * be free to agree with itself. Only `fetch` is stubbed. No adapter provider
 * is mounted, so `useAdapter()` returns `null` by design and the metadata /
 * data / schema endpoint families stay empty — that isolates these assertions
 * to the service-gated path without mocking any module.
 *
 * The last block is the tripwire the #4240 fix would have needed to be
 * caught: it derives the expected key vocabulary from the spec itself rather
 * than restating it, so a rename on EITHER side goes red instead of going
 * quiet.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { CoreServiceName } from '@objectstack/spec/system';

import {
  useApiDiscovery,
  SERVICE_ENDPOINT_CATALOG,
  type EndpointGroup,
} from './useApiDiscovery';

interface ServiceEntry {
  enabled?: boolean;
  status?: string;
  handlerReady?: boolean;
  route?: string;
}

/** A storage slot that is registered, honest and serving. */
const USABLE_STORAGE: ServiceEntry = {
  enabled: true,
  status: 'available',
  handlerReady: true,
  route: '/api/v1/storage',
};

function stubDiscovery(services: Record<string, ServiceEntry>, routes: Record<string, string> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/api/v1/discovery')) {
        return { ok: true, json: async () => ({ data: { routes, services } }) } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    }),
  );
}

async function groupsFor(
  services: Record<string, ServiceEntry>,
  routes: Record<string, string> = {},
): Promise<EndpointGroup[]> {
  stubDiscovery(services, routes);
  const { result } = renderHook(() => useApiDiscovery());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.groups;
}

const storageGroup = (groups: EndpointGroup[]) => groups.find(g => g.key === 'Storage');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApiDiscovery — the storage group (#4240, #5286, #5291)', () => {
  const STORAGE_ENDPOINTS = [
    'POST /api/v1/storage/upload',
    'GET /api/v1/storage/:fileId',
    'DELETE /api/v1/storage/:fileId',
  ];

  it('renders the Storage group from the canonical `storage` slot (framework #9683)', async () => {
    const groups = await groupsFor({ storage: USABLE_STORAGE });

    const storage = storageGroup(groups);
    expect(storage, 'Storage group must render when /discovery reports the canonical `storage` slot usable').toBeDefined();
    expect(storage!.endpoints.map(e => `${e.method} ${e.path}`)).toEqual(STORAGE_ENDPOINTS);
  });

  // The shape a v17 backend actually sends: the canonical row plus the
  // byte-equal copy under the deprecated alias key. One slot, one group.
  it('renders the group once against a backend that also mirrors the row under the deprecated alias', async () => {
    const groups = await groupsFor({ storage: USABLE_STORAGE, 'file-storage': { ...USABLE_STORAGE } });

    expect(groups.filter(g => g.key === 'Storage')).toHaveLength(1);
    expect(storageGroup(groups)!.endpoints.map(e => `${e.method} ${e.path}`)).toEqual(STORAGE_ENDPOINTS);
  });

  // #5291: the deprecated alias is not read at all — no fallback, no merge.
  // Before the re-key this page fell back to `file-storage` when `storage`
  // was absent; a consumer-side alias read is the tolerance the
  // contract-first rule forbids, and it would outlive the alias itself.
  it('does not read the deprecated `file-storage` alias — a row under it alone renders no Storage group', async () => {
    const groups = await groupsFor({ 'file-storage': USABLE_STORAGE });

    expect(storageGroup(groups), 'only the canonical `storage` slot may gate the Storage group').toBeUndefined();
  });

  it('honours the route /discovery advertises for the slot, not just the default', async () => {
    const groups = await groupsFor({
      storage: { ...USABLE_STORAGE, route: '/api/v2/files' },
    });

    expect(storageGroup(groups)!.endpoints.map(e => e.path)).toEqual([
      '/api/v2/files/upload',
      '/api/v2/files/:fileId',
      '/api/v2/files/:fileId',
    ]);
  });

  // `routes` is keyed like `ApiRoutesSchema`, which spells this family
  // `storage`. With the catalog keyed by the canonical slot, the same key
  // finds the flat route map when the service row carries no `route`.
  it('falls back to `routes.storage` when the service row advertises no route', async () => {
    const rowWithoutRoute: ServiceEntry = { enabled: true, status: 'available', handlerReady: true };
    const groups = await groupsFor({ storage: rowWithoutRoute }, { storage: '/api/v2/files' });

    expect(storageGroup(groups)!.endpoints.map(e => e.path)).toEqual([
      '/api/v2/files/upload',
      '/api/v2/files/:fileId',
      '/api/v2/files/:fileId',
    ]);
  });
});

// Fail-closed control (ADR-0076 D12). Green both before and after the #4240
// fix: the posture was never the bug, the key was. These cases are what stops
// a future "just render it anyway" from passing as a fix for #4240.
describe('useApiDiscovery — fail-closed posture is preserved (ADR-0076 D12)', () => {
  it('hides the Storage group when the slot is absent from /discovery', async () => {
    expect(storageGroup(await groupsFor({ ai: { enabled: true } }))).toBeUndefined();
  });

  // Annotated rather than inferred: `it.each` widens heterogeneous tuples to a
  // union that includes `string`, which would make `entry` unassignable below.
  const notUsable: Array<[string, ServiceEntry]> = [
    ['enabled:false (not registered)', { enabled: false }],
    ['status unavailable', { enabled: true, status: 'unavailable' }],
    ['status stub (a dev fake is not the real service)', { enabled: true, status: 'stub', handlerReady: true }],
    ['handlerReady:false (route advertised, no real handler)', { enabled: true, handlerReady: false }],
  ];

  it.each(notUsable)('hides the Storage group when the slot is present but not usable — %s', async (_label, entry) => {
    expect(storageGroup(await groupsFor({ storage: entry }))).toBeUndefined();
  });

  it('still renders the group when the slot is degraded — a serving fallback must stay visible', async () => {
    const groups = await groupsFor({
      storage: { enabled: true, status: 'degraded', handlerReady: true, route: '/api/v1/storage' },
    });
    expect(storageGroup(groups)?.endpoints).toHaveLength(3);
  });
});

// The AI group after the `/assistant` retirement (#11704). The three ambient
// assistant routes were retired on the server (objectstack-ai/cloud#2621) and a
// row for a route that answers 404 is a try-it button that can only fail. The
// named-agent route is the one chat door, so it must stay — that `toContain` is
// also the positive control: it proves the group rendered and its rows were
// enumerated, so the empty `/assistant` list below is a measurement, not a
// vacuous pass.
describe('useApiDiscovery — the AI group lists no retired /assistant row (#11704)', () => {
  const USABLE_AI: ServiceEntry = {
    enabled: true,
    status: 'available',
    handlerReady: true,
    route: '/api/v1/ai',
  };

  it('keeps the named-agent chat door and offers no /assistant route', async () => {
    const groups = await groupsFor({ ai: USABLE_AI });

    const ai = groups.find(g => g.key === 'AI');
    expect(ai, 'the AI group must render when /discovery reports the `ai` slot usable').toBeDefined();

    const rows = ai!.endpoints.map(e => `${e.method} ${e.path}`);
    expect(rows).toContain('POST /api/v1/ai/agents/:agentName/chat');
    expect(rows.filter(row => row.includes('/assistant'))).toEqual([]);
  });
});

/**
 * The tripwire (#4240 dispatch rider).
 *
 * The mis-key survived because nothing tied the catalog's keys to the
 * vocabulary they are spelled in. This block derives that vocabulary from
 * `@objectstack/spec` — the same package the framework declares it in — so a
 * rename on either side fails here rather than silently emptying a group.
 */
describe('SERVICE_ENDPOINT_CATALOG keys are canonical service-slot names', () => {
  const SLOTS = new Set<string>(CoreServiceName.options);

  it('the spec exports a usable slot vocabulary (guards the derivation itself)', () => {
    expect(SLOTS.size).toBeGreaterThan(5);
    expect(SLOTS.has('storage'), 'storage must be a declared CoreServiceName slot').toBe(true);
  });

  it('the storage group is keyed by the canonical slot, never by the deprecated alias', () => {
    expect(SERVICE_ENDPOINT_CATALOG.storage, 'catalog must be keyed by the canonical `storage` slot').toBeDefined();
    expect(SERVICE_ENDPOINT_CATALOG['file-storage'], '`file-storage` is a deprecated alias, never a catalog key').toBeUndefined();
    expect(SERVICE_ENDPOINT_CATALOG.storage.defaultRoute).toBe('/api/v1/storage');
  });

  it('every service-gated catalog key is a canonical slot', () => {
    const nonSlot = Object.keys(SERVICE_ENDPOINT_CATALOG).filter(k => !SLOTS.has(k));

    expect(
      nonSlot,
      'these catalog keys name no CoreServiceName slot, so /discovery can never report them '
        + 'and their groups will never render on any host — key them by the canonical slot name, '
        + 'or retire the entry',
    ).toEqual([]);
  });
});
