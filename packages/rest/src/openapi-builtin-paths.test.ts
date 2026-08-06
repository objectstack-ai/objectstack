// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pure half of the #5588 fix: mounted routes → OpenAPI `paths`.
 *
 * The serve-time half (that the document really carries THIS section, and that
 * the static artifact's stale one is discarded) is pinned in
 * `rest-openapi-route.test.ts` against a real `RestServer`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildBuiltinPaths,
  buildOperationId,
  isUnderBase,
  pathParameterNames,
  toTemplatePath,
  type BuiltinRouteFact,
} from './openapi-builtin-paths';

const route = (method: string, path: string, summary?: string, tags?: string[]): BuiltinRouteFact => ({
  method,
  path,
  metadata: summary === undefined && tags === undefined ? undefined : { summary, tags },
});

const collectingLogger = () => ({ error: vi.fn() });

describe('isUnderBase', () => {
  it('accepts the base itself and its descendants', () => {
    expect(isUnderBase('/api/v1', '/api/v1')).toBe(true);
    expect(isUnderBase('/api/v1/data/:object', '/api/v1')).toBe(true);
  });

  it('respects the segment boundary', () => {
    // `/api/v10` is not under `/api/v1`; a bare `startsWith` would say it is.
    expect(isUnderBase('/api/v10/data', '/api/v1')).toBe(false);
    expect(isUnderBase('/api/v2/data', '/api/v1')).toBe(false);
    expect(isUnderBase('/.well-known/objectstack', '/api/v1')).toBe(false);
  });

  it('keeps the project-scoped mirror out of the unscoped document', () => {
    // Both bases register the FULL surface and each gets its own
    // `openapi.json`; without this the unscoped document would list every
    // path twice.
    expect(isUnderBase('/api/v1/environments/:environmentId/data/:object', '/api/v1')).toBe(false);
    expect(isUnderBase('/api/v1/environments/:environmentId', '/api/v1')).toBe(false);
    // …while a route that merely starts with the same letters stays in.
    expect(isUnderBase('/api/v1/environmentsish', '/api/v1')).toBe(true);
  });

  it('lets the scoped document keep its own routes', () => {
    const scoped = '/api/v1/environments/:environmentId';
    expect(isUnderBase(`${scoped}/data/:object`, scoped)).toBe(true);
    expect(isUnderBase('/api/v1/data/:object', scoped)).toBe(false);
  });
});

describe('path conversion', () => {
  it('rewrites `:param` into `{param}`', () => {
    expect(toTemplatePath('/api/v1/data/:object/:id')).toBe('/api/v1/data/{object}/{id}');
    expect(toTemplatePath('/api/v1/meta')).toBe('/api/v1/meta');
    expect(toTemplatePath('/api/v1/data/:object/:id/shares/:shareId'))
      .toBe('/api/v1/data/{object}/{id}/shares/{shareId}');
  });

  it('reads the parameter names in order', () => {
    expect(pathParameterNames('/api/v1/data/:object/:id')).toEqual(['object', 'id']);
    expect(pathParameterNames('/api/v1/search')).toEqual([]);
  });
});

describe('buildOperationId', () => {
  it('is derived from the method and the path tail', () => {
    expect(buildOperationId('GET', '/api/v1/data/:object/:id', '/api/v1')).toBe('getDataByObjectById');
    expect(buildOperationId('PATCH', '/api/v1/data/:object/:id', '/api/v1')).toBe('patchDataByObjectById');
    expect(buildOperationId('GET', '/api/v1/openapi.json', '/api/v1')).toBe('getOpenapiJson');
    expect(buildOperationId('POST', '/api/v1/approvals/requests/:id/request-info', '/api/v1'))
      .toBe('postApprovalsRequestsByIdRequestInfo');
    expect(buildOperationId('GET', '/api/v1/meta/_drafts', '/api/v1')).toBe('getMetaDrafts');
  });

  it('names the bare base rather than emitting the verb alone', () => {
    expect(buildOperationId('GET', '/api/v1', '/api/v1')).toBe('getApiRoot');
  });

  it('is independent of the base, so both documents name the same operations', () => {
    const scoped = '/api/v1/environments/:environmentId';
    expect(buildOperationId('GET', `${scoped}/data/:object`, scoped))
      .toBe(buildOperationId('GET', '/api/v1/data/:object', '/api/v1'));
  });
});

describe('buildBuiltinPaths', () => {
  const routes: BuiltinRouteFact[] = [
    route('GET', '/api/v1/data/:object', 'Query records', ['data', 'crud']),
    route('POST', '/api/v1/data/:object', 'Create record', ['data', 'crud']),
    route('PATCH', '/api/v1/data/:object/:id', 'Update record', ['data', 'crud']),
    route('DELETE', '/api/v1/data/:object/:id', 'Delete record', ['data', 'crud']),
    route('GET', '/api/v1/forms/:slug', 'Resolve a public form spec by slug (anonymous)', ['forms', 'public']),
    route('GET', '/api/v1/meta', 'List all metadata types', ['metadata']),
  ];

  it('describes exactly the mounted routes, with the registered verbs', () => {
    const { paths, operationCount } = buildBuiltinPaths(routes, '/api/v1');
    expect(Object.keys(paths).sort()).toEqual([
      '/api/v1/data/{object}',
      '/api/v1/data/{object}/{id}',
      '/api/v1/forms/{slug}',
      '/api/v1/meta',
    ]);
    expect(Object.keys(paths['/api/v1/data/{object}']).sort()).toEqual(['get', 'post']);
    // PATCH is documented as PATCH. The section this replaced said `PUT`,
    // which the server answers with 405 (#5588).
    expect(Object.keys(paths['/api/v1/data/{object}/{id}']).sort()).toEqual(['delete', 'patch']);
    expect(paths['/api/v1/data/{object}/{id}'].put).toBeUndefined();
    expect(operationCount).toBe(6);
  });

  it('emits no wire-syntax parameter anywhere', () => {
    const { paths } = buildBuiltinPaths(routes, '/api/v1');
    for (const path of Object.keys(paths)) expect(path).not.toContain(':');
  });

  it('carries the registration summary, tags and path parameters', () => {
    const { paths, tags } = buildBuiltinPaths(routes, '/api/v1');
    const patch = paths['/api/v1/data/{object}/{id}'].patch as any;
    expect(patch.operationId).toBe('patchDataByObjectById');
    expect(patch.summary).toBe('Update record');
    expect(patch.tags).toEqual(['data', 'crud']);
    expect(patch.parameters).toEqual([
      { name: 'object', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    // The document's tag list is the union of what the operations use, in
    // first-seen order — produced with the section, not inherited from the
    // static artifact (whose `CRUD`/`Metadata`/`Discovery` nothing references).
    expect(tags).toEqual([{ name: 'data' }, { name: 'crud' }, { name: 'forms' }, { name: 'public' }, { name: 'metadata' }]);
  });

  it('says "no credentials" only where the registration says `public`', () => {
    const { paths } = buildBuiltinPaths(routes, '/api/v1');
    expect((paths['/api/v1/forms/{slug}'].get as any).security).toEqual([]);
    // Everything else inherits the document-level requirement rather than
    // claiming to be open — the one direction where a wrong claim leaks.
    expect((paths['/api/v1/meta'].get as any).security).toBeUndefined();
    expect((paths['/api/v1/data/{object}'].get as any).security).toBeUndefined();
  });

  it('offers a request body on body-carrying methods only, and never claims it is required', () => {
    const { paths } = buildBuiltinPaths(routes, '/api/v1');
    const post = paths['/api/v1/data/{object}'].post as any;
    expect(post.requestBody.content['application/json'].schema).toEqual({ type: 'object' });
    // Several built-in POSTs (approve / publish / rollback) act on the path
    // alone, so `required: true` would be a false claim for them.
    expect(post.requestBody.required).toBe(false);
    expect((paths['/api/v1/data/{object}'].get as any).requestBody).toBeUndefined();
    expect((paths['/api/v1/data/{object}/{id}'].delete as any).requestBody).toBeUndefined();
  });

  it('answers with `default` rather than inventing a status code', () => {
    // The success status is a per-handler fact the route table does not carry
    // (create answers 201, some deletes 204), so `200` would be wrong for
    // those rows. `default` is true of every row.
    const { paths } = buildBuiltinPaths(routes, '/api/v1');
    for (const item of Object.values(paths)) {
      for (const operation of Object.values(item)) {
        expect(Object.keys((operation as any).responses)).toEqual(['default']);
      }
    }
  });

  it('drops routes that belong to another base', () => {
    const { paths } = buildBuiltinPaths(
      [
        ...routes,
        route('GET', '/.well-known/objectstack', 'dispatcher, on the root'),
        route('GET', '/api/v2/data/:object', 'another version'),
        route('GET', '/api/v1/environments/:environmentId/data/:object', 'the scoped mirror'),
      ],
      '/api/v1',
    );
    expect(paths['/.well-known/objectstack']).toBeUndefined();
    expect(paths['/api/v2/data/{object}']).toBeUndefined();
    expect(paths['/api/v1/environments/{environmentId}/data/{object}']).toBeUndefined();
  });

  it('produces the scoped document from the scoped base, parameter and all', () => {
    const scoped = '/api/v1/environments/:environmentId';
    const { paths } = buildBuiltinPaths(
      [route('GET', `${scoped}/data/:object`, 'Query records', ['data', 'crud'])],
      scoped,
    );
    const item = paths['/api/v1/environments/{environmentId}/data/{object}'];
    expect(item).toBeDefined();
    expect((item.get as any).parameters.map((p: any) => p.name)).toEqual(['environmentId', 'object']);
  });

  it('reports — and does not silently shadow — paths OpenAPI would call identical', () => {
    // `/x/{a}` and `/x/{b}` are ONE path to OpenAPI. Impossible on today's
    // surface; if it ever starts happening the survivor must not be published
    // alone in silence.
    const logger = collectingLogger();
    const { paths } = buildBuiltinPaths(
      [route('GET', '/api/v1/thing/:id'), route('GET', '/api/v1/thing/:name')],
      '/api/v1',
      logger,
    );
    expect(Object.keys(paths)).toEqual(['/api/v1/thing/{id}']);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('differ only in parameter names');
  });

  it('keeps operationIds unique, loudly', () => {
    const logger = collectingLogger();
    const { paths } = buildBuiltinPaths(
      [route('GET', '/api/v1/a-b'), route('GET', '/api/v1/a/b')],
      '/api/v1',
      logger,
    );
    const ids = Object.values(paths).flatMap((item) => Object.values(item).map((op: any) => op.operationId));
    expect(ids).toEqual(['getAB', 'getAB2']);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('not unique');
  });

  it('survives a route table with junk in it', () => {
    const { paths, operationCount } = buildBuiltinPaths(
      [null as any, { method: 'GET' } as any, route('GET', '/api/v1/meta', 'List all metadata types', ['metadata'])],
      '/api/v1',
    );
    expect(Object.keys(paths)).toEqual(['/api/v1/meta']);
    expect(operationCount).toBe(1);
  });
});
