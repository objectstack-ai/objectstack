// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5040 E6 — declared endpoints in the OpenAPI document.
 *
 * Two jobs:
 *
 *  1. the positive shapes, driven straight through the pure enrichment with
 *    parsed declarations. Since the #5040 E7 publish flip these are the LIVE
 *    path — a real showcase boot serves an `/openapi.json` carrying its two
 *    declared endpoints
 *    (`packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`);
 *    the cases here pin the projection itself, apart from any boot;
 *  2. the empty-set invariant — with no declarations the document must come
 *    back not merely equivalent but IDENTICAL, which is what keeps a
 *    deployment that declares nothing byte-for-byte unchanged.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import {
  buildEndpointOperation,
  enrichOpenApiWithEndpoints,
  resolveSecurityRequirement,
  selectDocumentableEndpoints,
} from './openapi-endpoints';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A document shaped like the one `@objectstack/spec/openapi.json` ships. */
function baseDoc() {
  return {
    openapi: '3.1.0',
    info: { title: 'ObjectStack API', version: '17.0.0' },
    servers: [{ url: 'http://localhost:3000' }],
    paths: {
      '/api/{object}': { get: { operationId: 'listRecords' }, post: { operationId: 'createRecord' } },
      '/api/meta': { get: { operationId: 'getMeta' } },
    },
    components: { schemas: {}, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearerAuth: [] }],
  };
}

/** Parse a declaration the way the store's readers do — defaults materialised. */
function endpoint(input: Record<string, unknown>): ApiEndpoint {
  return ApiEndpointSchema.parse(input);
}

const OBJECT_FIND = {
  name: 'list_tasks',
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  type: 'object_operation',
  target: 'showcase_task',
  objectParams: { object: 'showcase_task', operation: 'find' },
};

function collectingLogger() {
  return { error: vi.fn() };
}

// ---------------------------------------------------------------------------
// The invariant this change stands on
// ---------------------------------------------------------------------------

describe('empty set — the served document does not move (#5093)', () => {
  it('returns the SAME document object when no api items are declared', () => {
    const doc = baseDoc();
    expect(enrichOpenApiWithEndpoints(doc, [])).toBe(doc);
  });

  it('serialises byte-identically to the un-enriched document', () => {
    const before = JSON.stringify(baseDoc());
    const after = JSON.stringify(enrichOpenApiWithEndpoints(baseDoc(), []));
    expect(after).toBe(before);
  });

  it('is byte-identical when every declared item is unparseable, too', () => {
    // The degenerate middle case: items exist, none survive the schema. The
    // document must land exactly where the empty case lands rather than
    // sprouting an empty `paths` rewrite.
    const logger = collectingLogger();
    const doc = baseDoc();
    const out = enrichOpenApiWithEndpoints(doc, [{ nope: true }, null], logger);
    expect(out).toBe(doc);
    expect(JSON.stringify(out)).toBe(JSON.stringify(baseDoc()));
  });

  it('leaves the base document untouched when endpoints ARE added', () => {
    // The enricher must copy, never mutate: the base spec is cached across
    // requests, so a mutation would leak one request's endpoints into every
    // later response.
    const doc = baseDoc();
    const snapshot = JSON.stringify(doc);
    const out = enrichOpenApiWithEndpoints(doc, [OBJECT_FIND]);
    expect(out).not.toBe(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(Object.keys((out as any).paths)).toContain('/api/v1/apps/showcase/tasks');
  });
});

// ---------------------------------------------------------------------------
// Entry shape, per endpoint type
// ---------------------------------------------------------------------------

describe('path entries', () => {
  it('emits the literal path and the lower-cased method', () => {
    const out = enrichOpenApiWithEndpoints(baseDoc(), [
      { ...OBJECT_FIND, method: 'DELETE', objectParams: { object: 'showcase_task', operation: 'delete' } },
    ]) as any;
    const item = out.paths['/api/v1/apps/showcase/tasks'];
    expect(Object.keys(item)).toEqual(['delete']);
    expect(item.delete.operationId).toBe('list_tasks');
  });

  it('carries `summary` / `description` when declared and omits them when not', () => {
    const documented = buildEndpointOperation(
      endpoint({ ...OBJECT_FIND, summary: 'List tasks', description: 'Open tasks for the caller.' }),
      undefined,
    );
    expect(documented.summary).toBe('List tasks');
    expect(documented.description).toBe('Open tasks for the caller.');

    const bare = buildEndpointOperation(endpoint(OBJECT_FIND), undefined);
    expect(bare).not.toHaveProperty('summary');
    expect(bare).not.toHaveProperty('description');
  });

  it('object_operation find: no id parameter, no body, 200', () => {
    const op = buildEndpointOperation(endpoint(OBJECT_FIND), undefined);
    expect(op).not.toHaveProperty('parameters');
    expect(op).not.toHaveProperty('requestBody');
    expect(Object.keys(op.responses as object)).toContain('200');
  });

  it.each(['get', 'update', 'delete'] as const)(
    'object_operation %s: documents the required `id` query parameter',
    (operation) => {
      const op = buildEndpointOperation(
        endpoint({ ...OBJECT_FIND, method: 'POST', objectParams: { object: 'showcase_task', operation } }),
        undefined,
      );
      const params = op.parameters as Array<Record<string, unknown>>;
      expect(params).toHaveLength(1);
      expect(params[0]).toMatchObject({ name: 'id', in: 'query', required: true });
    },
  );

  it('object_operation create: request body plus a 201', () => {
    const op = buildEndpointOperation(
      endpoint({ ...OBJECT_FIND, method: 'POST', objectParams: { object: 'showcase_task', operation: 'create' } }),
      undefined,
    );
    expect(op.requestBody).toEqual({
      required: true,
      content: { 'application/json': { schema: { type: 'object' } } },
    });
    expect(Object.keys(op.responses as object)).toContain('201');
  });

  it('never invents a response schema — only descriptions', () => {
    // The shipped document has ZERO component schemas (#5168), so any `$ref`
    // this module emitted would dangle. Descriptions are the honest maximum.
    const op = buildEndpointOperation(
      endpoint({ ...OBJECT_FIND, method: 'POST', objectParams: { object: 'showcase_task', operation: 'create' } }),
      undefined,
    );
    for (const response of Object.values(op.responses as Record<string, any>)) {
      expect(Object.keys(response)).toEqual(['description']);
    }
  });

  it('flow: the body is the flow input', () => {
    const op = buildEndpointOperation(
      endpoint({ name: 'purge', path: '/api/v1/apps/showcase/purge', method: 'POST', type: 'flow', target: 'janitor' }),
      undefined,
    );
    expect(op.requestBody).toBeDefined();
    expect(Object.keys(op.responses as object)).toContain('200');
  });

  it('omits the request body on methods that do not carry one', () => {
    const op = buildEndpointOperation(
      endpoint({ name: 'purge', path: '/api/v1/apps/showcase/purge', method: 'GET', type: 'flow', target: 'janitor' }),
      undefined,
    );
    expect(op).not.toHaveProperty('requestBody');
  });

  it.each(['script', 'proxy'] as const)('%s is documented as 501, not as working', (type) => {
    // Declared ≠ enforced is the defect this program removes; a document that
    // advertised these as live endpoints would re-create it in the one artifact
    // consumers generate clients from.
    const op = buildEndpointOperation(
      endpoint({ name: 'x', path: '/api/v1/apps/showcase/x', method: 'POST', type, target: 'whatever' }),
      undefined,
    );
    const responses = op.responses as Record<string, { description: string }>;
    expect(Object.keys(responses)).toContain('501');
    expect(responses['501'].description).toMatch(/does not execute/);
    expect(responses).not.toHaveProperty('200');
  });

  it('an object_operation missing objectParams is documented as 501', () => {
    const op = buildEndpointOperation(
      endpoint({ name: 'x', path: '/api/v1/apps/showcase/x', method: 'GET', type: 'object_operation', target: 't' }),
      undefined,
    );
    expect(Object.keys(op.responses as object)).toContain('501');
  });
});

// ---------------------------------------------------------------------------
// authRequired → security
// ---------------------------------------------------------------------------

describe('authRequired → security', () => {
  it('reads the requirement off the document rather than hard-coding a scheme', () => {
    expect(resolveSecurityRequirement(baseDoc())).toEqual([{ bearerAuth: [] }]);
    // No document-level default → fall back to the first declared scheme.
    expect(
      resolveSecurityRequirement({ components: { securitySchemes: { apiKey: {}, bearerAuth: {} } } } as any),
    ).toEqual([{ apiKey: [] }]);
    // Nothing declared → say nothing.
    expect(resolveSecurityRequirement({} as any)).toBeUndefined();
  });

  it('authRequired defaults to true and points at the document scheme', () => {
    const parsed = endpoint(OBJECT_FIND);
    expect(parsed.authRequired).toBe(true);
    const out = enrichOpenApiWithEndpoints(baseDoc(), [OBJECT_FIND]) as any;
    const op = out.paths['/api/v1/apps/showcase/tasks'].get;
    expect(op.security).toEqual([{ bearerAuth: [] }]);
    expect(op.responses).toHaveProperty('401');
  });

  it('authRequired: false emits an explicit empty security list', () => {
    const out = enrichOpenApiWithEndpoints(baseDoc(), [{ ...OBJECT_FIND, authRequired: false }]) as any;
    const op = out.paths['/api/v1/apps/showcase/tasks'].get;
    expect(op.security).toEqual([]);
    expect(op.responses).not.toHaveProperty('401');
  });

  it('does not share security-requirement objects with the base document', () => {
    const doc = baseDoc();
    const out = enrichOpenApiWithEndpoints(doc, [OBJECT_FIND]) as any;
    expect(out.paths['/api/v1/apps/showcase/tasks'].get.security[0]).not.toBe(doc.security[0]);
  });
});

// ---------------------------------------------------------------------------
// Loud skips
// ---------------------------------------------------------------------------

describe('invalid and conflicting declarations are skipped loudly', () => {
  it('drops an item that fails ApiEndpointSchema and names it', () => {
    const logger = collectingLogger();
    const kept = selectDocumentableEndpoints(
      [{ name: 'Bad Name', path: 'no-leading-slash', method: 'GET', type: 'flow', target: 't' }, OBJECT_FIND],
      logger,
    );
    expect(kept.map((e) => e.name)).toEqual(['list_tasks']);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain("'Bad Name'");
    expect(logger.error.mock.calls[0][0]).toContain('OMITTED');
  });

  it('resolves a duplicate route claim the way the endpoint matcher does', () => {
    // `buildEndpointIndex` keeps the lexicographically-first `name`. If this
    // module picked differently the document would name an endpoint the
    // runtime does not run — a lie with a straight face.
    const logger = collectingLogger();
    const kept = selectDocumentableEndpoints(
      [
        { ...OBJECT_FIND, name: 'zeta' },
        { ...OBJECT_FIND, name: 'alpha' },
      ],
      logger,
    );
    expect(kept.map((e) => e.name)).toEqual(['alpha']);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('duplicate endpoint claim');
  });

  it('treats a trailing slash as the same route the matcher treats it as', () => {
    const kept = selectDocumentableEndpoints([
      { ...OBJECT_FIND, name: 'alpha', path: '/api/v1/apps/showcase/tasks' },
      { ...OBJECT_FIND, name: 'beta', path: '/api/v1/apps/showcase/tasks/' },
    ]);
    expect(kept).toHaveLength(1);
  });

  it('never displaces a built-in path+method (ADR-0076)', () => {
    const logger = collectingLogger();
    const doc = baseDoc();
    const out = enrichOpenApiWithEndpoints(doc, [{ ...OBJECT_FIND, path: '/api/meta', method: 'GET' }], logger) as any;
    // The built-in operation is untouched, and since that was the only
    // declaration nothing was added — same document, byte for byte.
    expect(out).toBe(doc);
    expect(out.paths['/api/meta'].get.operationId).toBe('getMeta');
    expect(JSON.stringify(out)).toBe(JSON.stringify(baseDoc()));
    expect(logger.error.mock.calls[0][0]).toContain('one owner');
  });

  it('merges a new method into a path a built-in already describes', () => {
    const out = enrichOpenApiWithEndpoints(baseDoc(), [
      { ...OBJECT_FIND, path: '/api/meta', method: 'POST', objectParams: { object: 'x', operation: 'create' } },
    ]) as any;
    expect(out.paths['/api/meta'].get.operationId).toBe('getMeta');
    expect(out.paths['/api/meta'].post.operationId).toBe('list_tasks');
  });
});
