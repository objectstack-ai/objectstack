// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4016 — `MetadataClient.layered()` reads the three-layer projection
 * from the path the framework DECLARES for it, `GET /meta/:type/:name/layers`,
 * instead of flagging the ordinary item read.
 *
 * Why the move (objectstack#5882, ruled B by the maintainer; server half landed
 * in objectstack#6596): one route was answering two unrelated representations
 * chosen by a query flag, while `packages/spec` declared only the unflagged one.
 * Anything generating a client from the route table — SDK annotations, codegen,
 * an AI-written integration — produced a parser that was simply wrong for the
 * flagged call. The projection now has a path of its own AND a response schema
 * of its own (`GetMetaItemLayeredResponseSchema`); the flag still answers the
 * same body during a deprecation window, marked with RFC 9745 `Deprecation` and
 * an RFC 8288 `Link: rel="successor-version"`, and is scheduled for removal.
 *
 * `@objectstack/client` is not in the picture on purpose: the SDK expresses no
 * layered read in either spelling (the framework's REST route ledger records
 * this route as `server-only`, "consumed by objectui over plain HTTP"), so this
 * package builds the request and these cases are what hold it to the contract.
 *
 * The path expectation is DERIVED from the installed `@objectstack/spec` route
 * table rather than retyped here — a hand-copied string would keep passing
 * after the producer moved the route, which is the failure mode this whole card
 * exists to remove.
 *
 * The repo-wide half — that no shipped source file or skills guide reaches the
 * projection by query flag any more — is a ratchet over a scan surface wider
 * than this package, so it lives in
 * `scripts/__tests__/layered-read-declared-path-4016.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METADATA_ROUTES,
  GetMetaItemLayeredResponseSchema,
} from '@objectstack/spec/api';
import { MetadataClient } from './metadata-client';

const BASE_URL = 'http://localhost:3000';

/** The layered endpoint as the installed spec declares it. */
function specLayeredEndpoint() {
  const endpoints = (DEFAULT_METADATA_ROUTES as { endpoints: Array<Record<string, unknown>> }).endpoints;
  const matches = endpoints.filter((e) => e.handler === 'getMetaItemLayered');
  // If the producer ever declares this handler twice (or drops it), the
  // expectation below is meaningless — say so instead of silently picking one.
  expect(matches).toHaveLength(1);
  return matches[0] as { method: string; path: string; responseSchema?: string };
}

/** `http://host/api/v1/meta/object/showcase_project/layers`, spec-derived. */
function specLayeredUrl(type: string, name: string): string {
  const prefix = (DEFAULT_METADATA_ROUTES as { prefix: string }).prefix;
  const suffix = specLayeredEndpoint().path
    .replace(':type', type)
    .replace(':name', name);
  return `${BASE_URL}${prefix}${suffix}`;
}

/** A client over a fetch that records the URL and answers `body`. */
function clientAnswering(body: unknown, status = 200) {
  const urls: string[] = [];
  const client = new MetadataClient({
    baseUrl: BASE_URL,
    fetch: (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { client, urls };
}

/**
 * Exactly what the declared body carries — every layer, the load-time
 * diagnostics and the full ADR-0010 protection envelope. Validated against the
 * producer's own schema below, so the equivalence case cannot be green against
 * a shape no server sends.
 */
const LAYERED_BODY = {
  type: 'object',
  name: 'showcase_project',
  code: { name: 'showcase_project', label: 'Project', fields: { code: { type: 'text' } } },
  overlay: { label: 'Projects (ours)' },
  overlayScope: 'env',
  effective: { name: 'showcase_project', label: 'Projects (ours)', fields: { code: { type: 'text' } } },
  _diagnostics: { valid: false, errors: [{ path: 'label', message: 'too long', code: 'too_big' }] },
  lock: 'no-delete',
  lockReason: 'shipped by the crm package',
  lockSource: 'package',
  lockDocsUrl: 'https://docs.objectstack.ai/metadata/locks',
  provenance: 'package',
  packageId: 'crm',
  packageVersion: '1.2.3',
  editable: true,
  deletable: false,
  resettable: true,
} as const;

describe('objectui#4016 · the layered read goes to its declared path', () => {
  it('is declared by the installed spec as a GET on its own path with its own schema', () => {
    const endpoint = specLayeredEndpoint();
    expect(endpoint.method).toBe('GET');
    expect(endpoint.path).toBe('/:type/:name/layers');
    // The point of ruling B: a representation of its own, not a second shape
    // hiding behind the item read's schema.
    expect(endpoint.responseSchema).toBe('GetMetaItemLayeredResponseSchema');
  });

  it('requests the spec-declared path and carries no `layers` query flag', async () => {
    const { client, urls } = clientAnswering(LAYERED_BODY);

    await client.layered('object', 'showcase_project');

    expect(urls).toEqual([specLayeredUrl('object', 'showcase_project')]);
    // Belt and braces on the retired spelling: the flag is gone as a QUERY
    // parameter, not merely relocated inside the string.
    expect(urls[0]).not.toMatch(/[?&]layers=/);
    expect(urls[0]).not.toContain('?');
  });

  it('leads the query string with `?package=` instead of trailing it (ADR-0048)', async () => {
    const { client, urls } = clientAnswering(LAYERED_BODY);

    await client.layered('object', 'showcase_project', { packageId: 'crm/base' });

    // The migration's live trap: the package id used to be appended with `&`
    // behind the flag. Left as `&` it would have fused onto the last PATH
    // segment (`…/layers&package=crm%2Fbase`), which matches no route — a 404
    // that `layered()` reports as an empty-but-successful layered view.
    expect(urls).toEqual([`${specLayeredUrl('object', 'showcase_project')}?package=crm%2Fbase`]);
    expect(urls[0]).not.toContain('layers&');
  });

  it('percent-encodes the type and name into the path', async () => {
    const { client, urls } = clientAnswering(LAYERED_BODY);

    await client.layered('object', 'a/b c');

    expect(urls).toEqual([`${BASE_URL}/api/v1/meta/object/a%2Fb%20c/layers`]);
  });

  it('hands back every layer and protection carrier the declared body sends', async () => {
    // Guard the fixture first: a value verdict is being asserted, so the body
    // must parse fully green against the producer's schema, not merely avoid
    // unknown keys.
    const parsed = GetMetaItemLayeredResponseSchema.safeParse(LAYERED_BODY);
    expect(parsed.success).toBe(true);

    const { client } = clientAnswering(LAYERED_BODY);

    const layered = await client.layered<Record<string, unknown>>('object', 'showcase_project');

    // Behaviour equivalence with the retired spelling: same envelope, same
    // keys, `type` / `name` still dropped (the caller passed them in).
    expect(layered).toEqual({
      code: LAYERED_BODY.code,
      overlay: LAYERED_BODY.overlay,
      overlayScope: 'env',
      effective: LAYERED_BODY.effective,
      _diagnostics: LAYERED_BODY._diagnostics,
      lock: 'no-delete',
      lockReason: 'shipped by the crm package',
      lockSource: 'package',
      lockDocsUrl: 'https://docs.objectstack.ai/metadata/locks',
      provenance: 'package',
      packageId: 'crm',
      packageVersion: '1.2.3',
      editable: true,
      deletable: false,
      resettable: true,
    });
  });

  it('reports an unknown item as an empty layered view (404)', async () => {
    const { client } = clientAnswering({ error: 'not found' }, 404);

    await expect(client.layered('object', 'nope')).resolves.toEqual({
      code: null,
      overlay: null,
      overlayScope: null,
      effective: null,
    });
  });

  it('throws when the backend cannot serve the projection (501)', async () => {
    // The one intentional behaviour delta of the move, and it is the server's
    // call, not this client's: the retired flag FELL THROUGH to the plain item
    // read on a backend whose protocol implementation had no layered support,
    // answering `{ type, name, item }`. A dedicated path refuses to answer a
    // different resource under this one's declared shape and returns 501
    // `NOT_IMPLEMENTED` — which must surface, not degrade into a view whose
    // `code` and `overlay` are blank for a reason the operator cannot see.
    const { client } = clientAnswering(
      { error: 'Layered metadata view not supported by protocol implementation', code: 'NOT_IMPLEMENTED' },
      501,
    );

    await expect(client.layered('object', 'showcase_project')).rejects.toThrow();
  });
});
