// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The driver behind the real engine's external-driver floor: published under
 * a plugin driver id on a `schemaMode: 'external'` datasource, the engine
 * floors it, so a predicate the driver leaves out of `$filter` is still
 * applied — in memory, over the rows the service returned — and a refusal by
 * the service reaches the caller as the floor maps it.
 */

import { describe, expect, it } from 'vitest';
import {
  DatasourceUnavailableError,
  ExternalReadRefusedError,
  ExternalWriteRefusedError,
  ObjectQL,
  needsExternalDriverFloor,
} from '@objectstack/objectql';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import { parseODataDriverConfig } from './config.js';
import { ODataDriver } from './odata-driver.js';
import { METADATA_EXCHANGE, PEOPLE, SERVICE_ROOT, page, recordedService, type Exchange } from './__fixtures__/recorded-service.js';

const DATASOURCE = 'trippin';
const OBJECT = 'trip_person';
const DEF = { name: DATASOURCE, driver: DATASOURCE, schemaMode: 'external', external: { allowWrites: true } } as const;
const PERSON = {
  name: OBJECT,
  datasource: DATASOURCE,
  external: {
    remoteName: 'People',
    writable: true,
    columnMap: { UserName: 'user_name', FirstName: 'first_name', LastName: 'last_name', Age: 'age' },
  },
  fields: {
    user_name: { type: 'text' },
    first_name: { type: 'text' },
    last_name: { type: 'text' },
    age: { type: 'number' },
  },
};

function boot(exchanges: Exchange[]) {
  const service = recordedService([METADATA_EXCHANGE, ...exchanges]);
  const driver = new ODataDriver(parseODataDriverConfig({ name: DATASOURCE, serviceRoot: SERVICE_ROOT }), { fetch: service.fetch });
  // What the engine's boot binding pass does for every external object.
  driver.registerExternalObject(PERSON);
  const engine = new ObjectQL();
  engine.registerDriver(driver);
  engine.registerDatasourceDef(DEF);
  engine.registerApp({ id: 'trippin_pkg', name: 'TripPin', objects: [PERSON] } as never);
  return { engine, requests: service.requests };
}

/** A second W surname, beside TripPin's Russell Whyte. */
const WHITE = { ...PEOPLE[0], '@odata.etag': 'W/"william"', UserName: 'williamwhite', FirstName: 'William', LastName: 'White' };

const sent = (requests: { url: string }[]) => requests.map((r) => r.url).filter((url) => url !== '$metadata');

describe('driver-odata behind the engine floor', () => {
  it('is a plugin driver id, so the engine floors it', () => {
    expect(needsExternalDriverFloor(DEF)).toBe(true);
  });

  it('applies in memory what it does not push down: the service is asked the wider question', async () => {
    // `$like` has no `$filter` spelling, so only `startswith` reaches the service, which answers two rows.
    const { engine, requests } = boot([
      {
        url: "People?$filter=startswith(LastName,'W')&$orderby=UserName asc&$top=1001",
        body: page([PEOPLE[0], WHITE]),
      },
    ]);
    const rows = await engine.find(OBJECT, {
      where: { last_name: { $startsWith: 'W' }, first_name: { $like: 'Wil%' } },
      context: { isSystem: true },
    } as never);
    expect(sent(requests)).toEqual(["People?$filter=startswith(LastName,'W')&$orderby=UserName asc&$top=1001"]);
    expect(rows.map((r: Record<string, unknown>) => r.id)).toEqual(['williamwhite']);
  });

  it('counts through the floor\'s read, not the service\'s $count', async () => {
    const { engine, requests } = boot([
      { url: "People?$filter=startswith(LastName,'W')&$orderby=UserName asc&$top=1001", body: page([PEOPLE[0], WHITE]) },
    ]);
    expect(await engine.count(OBJECT, { where: { last_name: { $startsWith: 'W' } }, context: { isSystem: true } } as never)).toBe(2);
    expect(sent(requests)).toEqual(["People?$filter=startswith(LastName,'W')&$orderby=UserName asc&$top=1001"]);
  });

  it('a read the service refuses with 400 is INVALID_QUERY / 400 carrying the service\'s reason', async () => {
    const { engine } = boot([
      {
        url: "People?$filter=FirstName eq 'x'&$orderby=UserName asc&$top=1001",
        status: 400,
        body: { error: { code: 'BadRequest', message: "The property 'FirstName' cannot be used in the $filter query option." } },
      },
    ]);
    const err = await engine
      .find(OBJECT, { where: markFilterSubtreeProvenance({ first_name: 'x' }, 'author'), context: { isSystem: true } } as never)
      .then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(ExternalReadRefusedError);
    expect(err).toMatchObject({ code: 'INVALID_QUERY', status: 400 });
    expect((err as Error).message).toContain("cannot be used in the $filter query option");
  });

  it('a write the service refuses with a 4xx is EXTERNAL_WRITE_REFUSED / 422 carrying the service\'s reason', async () => {
    const { engine } = boot([
      {
        method: 'POST',
        url: 'People',
        status: 400,
        body: { error: { code: 'BadRequest', message: "The property 'LastName' is required." } },
      },
    ]);
    const err = await engine
      .insert(OBJECT, { user_name: 'lewisblack', first_name: 'Lewis' }, { context: { isSystem: true } } as never)
      .then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(ExternalWriteRefusedError);
    expect(err).toMatchObject({ code: 'EXTERNAL_WRITE_REFUSED', status: 422 });
    expect((err as Error).message).toContain("The property 'LastName' is required.");
  });

  it('a service failure is ERR_DATASOURCE_UNAVAILABLE / 503, its text withheld', async () => {
    const { engine } = boot([
      { url: 'People?$orderby=UserName asc&$top=1001', status: 503, body: { error: { code: 'ServiceUnavailable', message: 'backend sap-prod-07 is down' } } },
    ]);
    const err = await engine.find(OBJECT, { context: { isSystem: true } } as never).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(DatasourceUnavailableError);
    expect((err as Error).message).not.toContain('sap-prod-07');
  });
});
