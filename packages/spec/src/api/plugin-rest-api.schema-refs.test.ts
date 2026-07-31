// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3899 — the catalog's schema references are strings, and nothing consumed
 * them at runtime, so nothing ever noticed when one was wrong. Two ways wrong,
 * both shipped:
 *
 *   - `requestSchema: 'CreateManyRequestSchema'` named a schema no file ever
 *     exported (#3939 recorded it; repointed later). A reader — or an AI
 *     generating a client from the catalog — resolved a promise against a
 *     schema that did not exist.
 *   - `requestSchema` sat on GET/DELETE routes whose inputs are entirely
 *     path/query-bound, reading as "this endpoint 400s a bad body" for routes
 *     that have no body to validate.
 *
 * These checks make both structural: a dangling name or a body schema on a
 * bodyless method fails here, not in a consumer's generated client.
 *
 * The other half of the same gate — "a declared `requestSchema` actually 400s
 * a violating body" — needs the mounted routes, so it lives with the servers:
 * `packages/rest/src/request-schema-gate.conformance.test.ts` and
 * `packages/runtime/src/request-schema-gate.conformance.test.ts`. This file is
 * deliberately only the part the spec package can verify about itself.
 */

import { describe, it, expect } from 'vitest';
import { getDefaultRouteRegistrations } from './plugin-rest-api.zod';
import * as API from './index';

/** HTTP methods that carry a request body a schema could reject. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

interface EndpointRef {
  route: string;
  requestSchema?: string;
  responseSchema?: string;
  method: string;
}

function allEndpoints(): EndpointRef[] {
  return getDefaultRouteRegistrations().flatMap((reg) =>
    (reg.endpoints ?? []).map((ep) => ({
      route: `${ep.method} ${reg.prefix}${ep.path}`,
      requestSchema: ep.requestSchema,
      responseSchema: ep.responseSchema,
      method: ep.method,
    })),
  );
}

function resolvesToZodSchema(name: string): boolean {
  const candidate = (API as Record<string, unknown>)[name];
  return !!candidate && typeof (candidate as { safeParse?: unknown }).safeParse === 'function';
}

describe('#3899 — catalog schema references resolve and sit on the right methods', () => {
  it('every requestSchema names a Zod schema exported from @objectstack/spec/api', () => {
    for (const ep of allEndpoints()) {
      if (!ep.requestSchema) continue;
      expect(
        resolvesToZodSchema(ep.requestSchema),
        `${ep.route} declares requestSchema '${ep.requestSchema}', which is not an exported Zod schema — a promise no consumer can resolve`,
      ).toBe(true);
    }
  });

  it('every responseSchema names a Zod schema exported from @objectstack/spec/api', () => {
    for (const ep of allEndpoints()) {
      if (!ep.responseSchema) continue;
      expect(
        resolvesToZodSchema(ep.responseSchema),
        `${ep.route} declares responseSchema '${ep.responseSchema}', which is not an exported Zod schema`,
      ).toBe(true);
    }
  });

  it('requestSchema appears only on body-carrying methods (POST/PUT/PATCH)', () => {
    // A GET/DELETE input is path/query-bound: strings all the way down, no
    // body for a schema to reject. A requestSchema there is a promise of a
    // validation that cannot happen — the #3899 ① shape.
    for (const ep of allEndpoints()) {
      if (!ep.requestSchema) continue;
      expect(
        BODY_METHODS.has(ep.method),
        `${ep.route} declares requestSchema '${ep.requestSchema}' on a bodyless method — nothing can violate it, so the declaration only misleads`,
      ).toBe(true);
    }
  });

  it('at least the routes wired in #3899 still declare their request schemas', () => {
    // Anti-erosion floor: the gate above is vacuous if declarations are simply
    // deleted. These five are validated at their mounted routes.
    const declared = new Map(
      allEndpoints().filter((e) => e.requestSchema).map((e) => [e.route, e.requestSchema]),
    );
    expect(declared.get('POST /api/v1/data/:object/query')).toBe('FindDataRequestSchema');
    expect(declared.get('POST /api/v1/data/:object')).toBe('CreateDataRequestSchema');
    expect(declared.get('PATCH /api/v1/data/:object/:id')).toBe('UpdateDataRequestSchema');
    expect(declared.get('POST /api/v1/data/:object/batch')).toBe('BatchUpdateRequestSchema');
    expect(declared.get('POST /api/v1/data/:object/createMany')).toBe('CreateManyDataRequestSchema');
    expect(declared.get('POST /api/v1/notifications/read')).toBe('MarkNotificationsReadRequestSchema');
    expect(declared.get('POST /api/v1/analytics/query')).toBe('AnalyticsQueryRequestSchema');
  });
});
