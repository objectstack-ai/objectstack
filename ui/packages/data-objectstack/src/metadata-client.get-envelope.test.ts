/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4271 — `MetadataClient.get()` honors its documented unwrapped-body
 * contract.
 *
 * The framework answers `GET /meta/:type/:name` with the spec-declared
 * envelope `{ type, name, item, ...protection fields }`
 * (`GetMetaItemResponseSchema`; objectstack#5563 collapsed the read to that ONE
 * shape). `get()` used to hand that envelope straight back while its own
 * docblock promised the unwrapped body — so every consumer reading `obj.fields`
 * saw `undefined`, which is how the whole field half of the permission matrix
 * went dead for every object.
 *
 * The asymmetry that IS real and stays: `getDraft()` documents the envelope and
 * its callers read `.item`, so it must keep returning what the server sent.
 * A11/A10 below are the pair that pins both halves.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient, type MetadataError } from './metadata-client';

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** A client whose single-item read answers `body`, recording the URLs it hit. */
function clientAnswering(body: unknown, init?: ResponseInit) {
  const urls: string[] = [];
  const c = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: mockFetch(async (url) => {
      urls.push(url);
      return init ? new Response(JSON.stringify(body), init) : jsonResponse(body);
    }),
  });
  return { c, urls };
}

/** The card's live shape: 21 fields under `item`, as showcase_project answers. */
const OBJECT_BODY = {
  name: 'showcase_project',
  label: 'Project',
  fields: { name: { type: 'text' }, stage: { type: 'select' } },
};
const ENVELOPE = { type: 'object', name: 'showcase_project', item: OBJECT_BODY };

describe('objectui#4271 · MetadataClient.get() unwraps the spec envelope', () => {
  it('A1: unwraps `{type,name,item}` to the item body', async () => {
    const { c } = clientAnswering(ENVELOPE);
    const obj = await c.get<Record<string, unknown>>('object', 'showcase_project');
    expect(obj).toEqual(OBJECT_BODY);
    // The headline consequence: the field map is reachable again.
    expect(Object.keys((obj as any)?.fields ?? {})).toEqual(['name', 'stage']);
  });

  it('A2: unwraps when the ADR-0008 protection carriers ride along', async () => {
    // `GetMetaItemResponseSchema` spreads MetadataProtectionEnvelopeFields, so
    // a real envelope carries more than three keys. Unwrapping must not be
    // conditioned on the key COUNT.
    const { c } = clientAnswering({
      ...ENVELOPE,
      lock: { locked: false, reason: 'ok' },
      provenance: { origin: 'package' },
    });
    expect(await c.get('object', 'showcase_project')).toEqual(OBJECT_BODY);
  });

  it('A3: an envelope carrying a null item reads as null', async () => {
    const { c } = clientAnswering({ type: 'object', name: 'ghost', item: null });
    expect(await c.get('object', 'ghost')).toBeNull();
  });
});

describe('objectui#4271 · non-envelope responses pass through UNCHANGED', () => {
  it('A4: a bare body (older server / already-unwrapped) is returned as-is', async () => {
    const { c } = clientAnswering(OBJECT_BODY);
    expect(await c.get('object', 'showcase_project')).toEqual(OBJECT_BODY);
  });

  it('A5: type+name WITHOUT an `item` key is not unwrapped', async () => {
    // A metadata document may legitimately carry `type` and `name` of its own
    // (a view is `{name, type: "grid", ...}`). Absent `item`, it is the body.
    const view = { name: 'all_projects', type: 'grid', columns: ['name'] };
    const { c } = clientAnswering(view);
    expect(await c.get('view', 'all_projects')).toEqual(view);
  });

  it('A6: an `item` key WITHOUT the envelope identity is not unwrapped', async () => {
    // Presence-checked against the spec shape, not duck-guessed off `item`
    // alone — a body whose own schema has an `item` property stays whole.
    const body = { name: 'cart', item: { sku: 'x' } };
    const { c } = clientAnswering(body);
    expect(await c.get('object', 'cart')).toEqual(body);
  });

  it('A7: an array response passes through', async () => {
    const { c } = clientAnswering([{ name: 'a' }]);
    expect(await c.get('object', 'weird')).toEqual([{ name: 'a' }]);
  });

  it('A8: 404 still reads as null', async () => {
    const { c } = clientAnswering({}, { status: 404 });
    expect(await c.get('object', 'missing')).toBeNull();
  });

  it('A9: error responses still throw with status, code and message intact', async () => {
    const { c } = clientAnswering(
      { error: { code: 'RESOURCE_FORBIDDEN', message: 'Nope.' } },
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
    await expect(c.get('object', 'secret')).rejects.toThrow('Nope.');
    const err = await c.get('object', 'secret').catch((e: MetadataError) => e);
    expect((err as MetadataError).status).toBe(403);
    expect((err as MetadataError).code).toBe('RESOURCE_FORBIDDEN');
  });
});

describe('objectui#4271 · the getDraft() envelope asymmetry is preserved', () => {
  it('A10: getDraft() returns the RAW envelope, as its docblock promises', async () => {
    // Load-bearing: ~11 call sites read `.item` off getDraft (StudioDesignSurface,
    // ResourceEditPage, PackageOwdOverviewPanel, ObjectHooksPanel,
    // PermissionMatrixEditor). Routing getDraft through the unwrapping get()
    // would silently empty every one of them.
    const draftEnvelope = { type: 'object', name: 'showcase_project', item: OBJECT_BODY };
    // objectui#11799 — the item read follows the drafts ledger, which lists it.
    const urls: string[] = [];
    const c = new MetadataClient({
      baseUrl: 'http://localhost:3000',
      fetch: mockFetch(async (url) => {
        urls.push(url);
        return jsonResponse(
          url.endsWith('/meta/_drafts') ? { drafts: [{ type: 'object', name: 'showcase_project' }] } : draftEnvelope,
        );
      }),
    });
    const draft = await c.getDraft<Record<string, unknown>>('object', 'showcase_project');
    expect(draft).toEqual(draftEnvelope);
    expect((draft as any)?.item).toEqual(OBJECT_BODY);
    expect(urls).toEqual([
      'http://localhost:3000/api/v1/meta/_drafts',
      'http://localhost:3000/api/v1/meta/object/showcase_project?state=draft',
    ]);
  });

  it('A11: get(state:draft) unwraps like any other get()', async () => {
    // The SHAPE follows the method's published contract, not the query param:
    // `get()` promises the body on every path it serves.
    const { c, urls } = clientAnswering(ENVELOPE);
    expect(await c.get('object', 'showcase_project', { state: 'draft' })).toEqual(OBJECT_BODY);
    expect(urls[0]).toBe('http://localhost:3000/api/v1/meta/object/showcase_project?state=draft');
  });

  it('A12: URL construction is untouched by the unwrap', async () => {
    const { c, urls } = clientAnswering(ENVELOPE);
    await c.get('object', 'has spaces', { packageId: 'app.crm' });
    expect(urls[0]).toBe('http://localhost:3000/api/v1/meta/object/has%20spaces?package=app.crm');
    const preview = new MetadataClient({
      baseUrl: 'http://localhost:3000',
      previewDrafts: true,
      fetch: mockFetch(async (url) => {
        urls.push(url);
        return jsonResponse(ENVELOPE);
      }),
    });
    // The overlay flag still rides, and the preview read unwraps too.
    expect(await preview.get('object', 'showcase_project')).toEqual(OBJECT_BODY);
    expect(urls[1]).toBe('http://localhost:3000/api/v1/meta/object/showcase_project?preview=draft');
  });
});
