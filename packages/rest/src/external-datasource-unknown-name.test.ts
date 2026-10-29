// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The federation twins on a name that resolves no saved datasource.
 *
 * `GET /datasources/:name/external/tables`, `POST …/external/tables/:remote/draft`,
 * `POST …/external/tables/:remote/import` and `POST …/external/refresh-catalog`
 * all run the service's federation guard first. It folded a name with no
 * datasource definition into "not a federation source", and this family's
 * catch answered every non-fault throw `400`, so an unknown name got the
 * federation lecture as a malformed request, where `GET /datasources/:name`
 * answers it `404 RESOURCE_NOT_FOUND`, `Datasource "NAME" does not exist.`
 * (its words, asserted equal to the admin route's answer in
 * `service-datasource`'s `federation-doors-unknown-name.test.ts`).
 *
 * The ruling these pins hold: no definition ⇒ that `404`, relayed by
 * {@link registerExternalDatasourceRoutes}'s catch; a definition that is not a
 * federation source ⇒ the door's `400` and code, unchanged.
 *
 * The service under the routes is the REAL `ExternalDatasourceService` (this
 * package's `vitest.config.ts` aliases the specifier to its `src/`), over an
 * introspector that must never be reached: every answer here is the guard's.
 * Driven through the real `HonoHttpServer`.
 */

import { describe, it, expect } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { ExternalDatasourceService } from '@objectstack/service-datasource';
import { registerExternalDatasourceRoutes } from './external-datasource-routes.js';

/** `warehouse` exists and is managed: it declares no `schemaMode`. */
const DEFINITIONS: Record<string, { name: string; schemaMode?: 'managed' | 'external' }> = {
  warehouse: { name: 'warehouse' },
};

function mount() {
  const service = new ExternalDatasourceService({
    introspect: async () => {
      throw new Error('introspect must not be reached');
    },
    getDatasource: async (name: string) => DEFINITIONS[name],
    getObject: async () => undefined,
    listObjects: async () => [],
    persistObject: async () => {
      throw new Error('persistObject must not be reached');
    },
  });
  const server = new HonoHttpServer(0);
  registerExternalDatasourceRoutes(
    server,
    {
      getService: (name: string) => {
        if (name === 'external-datasource') return service;
        throw new Error(`no service: ${name}`);
      },
    } as any,
    '/api/v1',
    { resolveExecutionContext: async () => ({ userId: 'u_admin', systemPermissions: ['manage_platform_settings', 'manage_metadata'] }) },
  );
  const app = server.getRawApp();
  return async (method: 'GET' | 'POST', path: string) => {
    const res = await app.fetch(
      new Request(`http://local/api/v1/datasources${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  };
}

/** Each twin, its path for `name`, and the code its refusals carry. */
const TWINS: Array<[door: string, method: 'GET' | 'POST', path: (name: string) => string, code: string]> = [
  ['GET …/external/tables', 'GET', (n) => `/${n}/external/tables`, 'EXTERNAL_DATASOURCE_ERROR'],
  ['POST …/external/tables/:remote/draft', 'POST', (n) => `/${n}/external/tables/orders/draft`, 'EXTERNAL_DATASOURCE_ERROR'],
  ['POST …/external/tables/:remote/import', 'POST', (n) => `/${n}/external/tables/orders/import`, 'EXTERNAL_IMPORT_ERROR'],
  ['POST …/external/refresh-catalog', 'POST', (n) => `/${n}/external/refresh-catalog`, 'EXTERNAL_DATASOURCE_ERROR'],
];

describe('the federation twins on a name that resolves no saved datasource', () => {
  it.each(TWINS)('%s answers 404 RESOURCE_NOT_FOUND in the words GET /datasources/:name uses', async (_d, method, path) => {
    const call = mount();

    const answer = await call(method, path('no_such_ds'));

    expect({
      status: answer.status,
      success: answer.body.success,
      code: answer.body.error?.code,
      message: answer.body.error?.message,
    }).toEqual({
      status: 404,
      success: false,
      code: 'RESOURCE_NOT_FOUND',
      message: 'Datasource "no_such_ds" does not exist.',
    });
    expect(answer.body).not.toHaveProperty('data');
  });
});

describe('the federation twins on a datasource that exists and is not a federation source', () => {
  it.each(TWINS)('%s still refuses a managed datasource 400 with its own code', async (_d, method, path, code) => {
    const call = mount();

    const answer = await call(method, path('warehouse'));

    expect({ status: answer.status, code: answer.body.error?.code }).toEqual({ status: 400, code });
    expect(answer.body.error.message).toContain("Datasource 'warehouse' is managed");
  });

  it.each(TWINS)('%s still refuses the primary datasource 400 with its own code', async (_d, method, path, code) => {
    const call = mount();

    const answer = await call(method, path('default'));

    expect({ status: answer.status, code: answer.body.error?.code }).toEqual({ status: 400, code });
    expect(answer.body.error.message).toContain("is the platform's managed primary datasource");
  });
});
