// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The driver against a recorded TripPin-shaped service: each test names the
 * exact requests the driver sends and answers them from recordings.
 */

import { describe, expect, it } from 'vitest';
import { parseODataDriverConfig } from './config.js';
import { ODataDriver } from './odata-driver.js';
import { ODataRequestError } from './transport.js';
import {
  METADATA_EXCHANGE,
  PEOPLE,
  SERVICE_ROOT,
  page,
  recordedService,
  type Exchange,
} from './__fixtures__/recorded-service.js';

const PERSON = {
  name: 'trip_person',
  external: {
    remoteName: 'People',
    columnMap: {
      UserName: 'user_name', FirstName: 'first_name', LastName: 'last_name', MiddleName: 'middle_name',
      Gender: 'gender', Age: 'age', Emails: 'emails', AddressInfo: 'address_info', Concurrency: 'concurrency',
    },
  },
};

function driverFor(exchanges: Exchange[], extra: { credential?: () => Promise<string | undefined>; auth?: { scheme: 'bearer' } } = {}) {
  const service = recordedService([METADATA_EXCHANGE, ...exchanges]);
  const config = parseODataDriverConfig({ name: 'trippin', serviceRoot: SERVICE_ROOT, pageSize: 2, ...(extra.auth ? { auth: extra.auth } : {}) });
  const driver = new ODataDriver(config, { fetch: service.fetch, ...(extra.credential ? { credential: extra.credential } : {}) });
  driver.registerExternalObject(PERSON);
  return { driver, requests: service.requests };
}

const urls = (requests: { method: string; url: string }[]) =>
  requests.filter((r) => r.url !== '$metadata').map((r) => `${r.method} ${r.url}`);

describe('reads', () => {
  it('pushes the where down, renames through the column map, drops annotations and sets id to the key', async () => {
    const { driver, requests } = driverFor([
      { url: "People?$filter=FirstName eq 'Russell'", body: page([PEOPLE[0]]) },
    ]);
    const rows = await driver.find('trip_person', { where: { first_name: 'Russell' } });
    expect(urls(requests)).toEqual(["GET People?$filter=FirstName eq 'Russell'"]);
    expect(rows).toEqual([{
      id: 'russellwhyte', user_name: 'russellwhyte', first_name: 'Russell', last_name: 'Whyte', middle_name: null,
      gender: 'Male', age: null, emails: ['Russell@example.com', 'Russell@contoso.com'],
      address_info: [{ Address: '187 Suffolk Ln.', City: { Name: 'Boise', CountryRegion: 'United States', Region: 'ID' } }],
      concurrency: 0,
    }]);
  });

  it('asks for the page size, follows @odata.nextLink and stops at the limit', async () => {
    const { driver, requests } = driverFor([
      {
        url: 'People?$orderby=UserName asc&$top=3',
        body: page(PEOPLE.slice(0, 2), { '@odata.nextLink': `${SERVICE_ROOT}People?$orderby=UserName asc&$top=1&$skiptoken='scottketchum'` }),
      },
      { url: "People?$orderby=UserName asc&$top=1&$skiptoken='scottketchum'", body: page(PEOPLE.slice(2, 4)) },
    ]);
    const rows = await driver.find('trip_person', { limit: 3 });
    expect(rows.map((r) => r.id)).toEqual(['russellwhyte', 'scottketchum', 'ronaldmundy']);
    expect(urls(requests)).toEqual([
      'GET People?$orderby=UserName asc&$top=3',
      "GET People?$orderby=UserName asc&$top=1&$skiptoken='scottketchum'",
    ]);
    expect(requests[1]!.headers.Prefer).toBe('odata.maxpagesize=2');
    expect(requests[1]!.headers['OData-Version']).toBe('4.0');
  });

  it('orders a paged read by the requested fields, then the key; pushes $skip and $select', async () => {
    const { driver, requests } = driverFor([
      { url: 'People?$orderby=LastName desc,UserName asc&$select=UserName,FirstName&$skip=2&$top=2', body: page([]) },
    ]);
    await driver.find('trip_person', { orderBy: [{ field: 'last_name', order: 'desc' }], fields: ['first_name'], offset: 2, limit: 2 });
    expect(urls(requests)).toEqual(['GET People?$orderby=LastName desc,UserName asc&$select=UserName,FirstName&$skip=2&$top=2']);
  });

  it('refuses a paged read sorted by a field the service cannot sort by, rather than paging another order', async () => {
    const { driver } = driverFor([]);
    await expect(driver.find('trip_person', { orderBy: [{ field: 'emails', order: 'asc' }], limit: 5 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/sorts by 'emails'/) });
  });

  it('refuses a nextLink to another origin, which would carry the credential elsewhere', async () => {
    const { driver } = driverFor([
      { url: 'People', body: page([PEOPLE[0]], { '@odata.nextLink': 'https://elsewhere.example/People?$skiptoken=1' }) },
    ]);
    await expect(driver.find('trip_person', {})).rejects.toThrow(/link to another origin; it is not followed/);
  });

  it('counts with $count=true when the whole where was translated', async () => {
    const { driver, requests } = driverFor([
      { url: "People?$count=true&$top=0&$filter=startswith(LastName,'W')", body: page([], { '@odata.count': 2 }) },
    ]);
    expect(await driver.count('trip_person', { where: { last_name: { $startsWith: 'W' } } })).toBe(2);
    expect(urls(requests)).toEqual(["GET People?$count=true&$top=0&$filter=startswith(LastName,'W')"]);
  });

  it('refuses a count it could only over-count', async () => {
    const { driver, requests } = driverFor([]);
    await expect(driver.count('trip_person', { where: { last_name: { $like: 'W%' } } }))
      .rejects.toMatchObject({ status: 400 });
    expect(urls(requests)).toEqual([]);
  });

  it('answers a refused read with the HTTP status and the service message, never the URL', async () => {
    const { driver } = driverFor([
      { url: "People?$filter=FirstName eq 'x'", status: 400, body: { error: { code: 'BadRequest', message: 'The query specified in the URI is not valid.' } } },
    ]);
    const error = await driver.find('trip_person', { where: { first_name: 'x' } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ODataRequestError);
    expect(error).toMatchObject({ status: 400, odataCode: 'BadRequest' });
    expect((error as Error).message).toBe("OData service refused GET on 'People' (HTTP 400): The query specified in the URI is not valid.");
    expect((error as Error).message).not.toContain('example.test');
  });

  it('names an entity set the service does not declare', async () => {
    const { driver } = driverFor([]);
    driver.registerExternalObject({ name: 'trip_ghost', external: { remoteName: 'Ghosts' } });
    await expect(driver.find('trip_ghost', {})).rejects.toThrow(/entity set 'Ghosts', which the service's \$metadata does not declare/);
  });

  it('reads $metadata once', async () => {
    const { driver, requests } = driverFor([{ url: 'People', body: page([]) }]);
    await driver.find('trip_person', {});
    await driver.find('trip_person', {});
    expect(requests.filter((r) => r.url === '$metadata')).toHaveLength(1);
  });
});

describe('writes', () => {
  it('creates with POST, sending only declared properties under their remote names', async () => {
    const created = { ...PEOPLE[0], UserName: 'lewisblack', FirstName: 'Lewis', LastName: 'Black' };
    const { driver, requests } = driverFor([{ method: 'POST', url: 'People', status: 201, body: created }]);
    const row = await driver.create('trip_person', {
      id: 'generated-by-engine', user_name: 'lewisblack', first_name: 'Lewis', last_name: 'Black', created_at: '2026-10-29T00:00:00Z',
    });
    expect(requests[1]).toMatchObject({
      method: 'POST', url: 'People',
      body: { UserName: 'lewisblack', FirstName: 'Lewis', LastName: 'Black' },
      headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    });
    expect(row.id).toBe('lewisblack');
  });

  it('updates with PATCH by key, If-Match from the last read, without the key or engine stamps in the body', async () => {
    const { driver, requests } = driverFor([
      { url: "People?$filter=UserName eq 'russellwhyte'", body: page([PEOPLE[0]]) },
      { method: 'PATCH', url: "People('russellwhyte')", body: { ...PEOPLE[0], LastName: 'White', '@odata.etag': 'W/"new"' } },
    ]);
    await driver.find('trip_person', { where: { id: 'russellwhyte' } });
    const row = await driver.update('trip_person', 'russellwhyte', { id: 'russellwhyte', last_name: 'White', user_name: 'russellwhyte', updated_at: 'x' });
    expect(requests[2]).toMatchObject({
      method: 'PATCH', url: "People('russellwhyte')", body: { LastName: 'White' },
      headers: { 'If-Match': 'W/"08D8D4E1A3B1C2F0"' },
    });
    expect(row?.last_name).toBe('White');
  });

  it('re-reads after a 204 PATCH and answers null for a key the service does not have', async () => {
    const { driver, requests } = driverFor([
      { method: 'PATCH', url: "People('scottketchum')", status: 204 },
      { url: "People('scottketchum')", body: PEOPLE[1] },
      { method: 'PATCH', url: "People('nobody')", status: 404, body: { error: { code: 'NotFound', message: 'gone' } } },
    ]);
    expect((await driver.update('trip_person', 'scottketchum', { first_name: 'Scott' }))?.id).toBe('scottketchum');
    expect(requests[1]!.headers['If-Match']).toBeUndefined();
    expect(await driver.update('trip_person', 'nobody', { first_name: 'x' })).toBeNull();
  });

  it('carries a refused write as its status, for the floor to map', async () => {
    const { driver } = driverFor([
      { method: 'PATCH', url: "People('russellwhyte')", status: 412, body: { error: { code: 'PreconditionFailed', message: 'The ETag does not match.' } } },
    ]);
    await expect(driver.update('trip_person', 'russellwhyte', { last_name: 'x' }))
      .rejects.toMatchObject({ status: 412, message: expect.stringContaining('The ETag does not match.') });
  });

  it('deletes by key: true when deleted, false when the service has no such entity', async () => {
    const { driver, requests } = driverFor([
      { method: 'DELETE', url: "People('russellwhyte')", status: 204 },
      { method: 'DELETE', url: "People('nobody')", status: 404 },
    ]);
    expect(await driver.delete('trip_person', 'russellwhyte')).toBe(true);
    expect(await driver.delete('trip_person', 'nobody')).toBe(false);
    expect(urls(requests)).toEqual(["DELETE People('russellwhyte')", "DELETE People('nobody')"]);
  });

  it('refuses the verbs it does not offer by name, as a request refusal', async () => {
    const { driver } = driverFor([]);
    await expect(driver.bulkCreate('trip_person', [{}])).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/bulkCreate .*not offered/) });
    await expect(driver.upsert('trip_person', {})).rejects.toMatchObject({ status: 400 });
    await expect(driver.beginTransaction()).rejects.toMatchObject({ status: 400 });
  });
});

describe('keys', () => {
  const ORDER_METADATA = `<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Shop">
      <EntityType Name="OrderLine"><Key><PropertyRef Name="OrderID"/><PropertyRef Name="Sku"/></Key>
        <Property Name="OrderID" Type="Edm.Int32" Nullable="false"/><Property Name="Sku" Type="Edm.String" Nullable="false"/>
        <Property Name="Quantity" Type="Edm.Int16"/></EntityType>
      <EntityContainer Name="C"><EntitySet Name="OrderLines" EntityType="Shop.OrderLine"/></EntityContainer>
    </Schema></edmx:DataServices></edmx:Edmx>`;

  it('spells a composite key as the predicate body and reads it back for a write', async () => {
    const service = recordedService([
      { url: '$metadata', body: ORDER_METADATA },
      { url: 'OrderLines', body: { value: [{ OrderID: 7, Sku: "A,B'1", Quantity: 2 }] } },
      { method: 'DELETE', url: "OrderLines(OrderID=7,Sku='A,B''1')", status: 204 },
    ]);
    const driver = new ODataDriver(parseODataDriverConfig({ serviceRoot: SERVICE_ROOT }), { fetch: service.fetch });
    driver.registerExternalObject({ name: 'order_line', external: { remoteName: 'OrderLines' } });
    const [row] = await driver.find('order_line', {});
    expect(row!.id).toBe("OrderID=7,Sku='A,B''1'");
    expect(await driver.delete('order_line', row!.id as string)).toBe(true);
    expect(await driver.delete('order_line', 'not a predicate')).toBe(false);
  });
});

describe('introspection', () => {
  it('lists entity sets as tables, with EDM types, the key and single-valued navigations as lookup candidates', async () => {
    const { driver } = driverFor([]);
    const schema = await driver.introspectSchema();
    expect(schema.dialect).toBe('odata-4.0');
    expect(Object.keys(schema.tables)).toEqual(['People', 'Photos', 'Airlines', 'Flights']);
    const people = schema.tables.People!;
    expect(people.columns.find((c) => c.name === 'UserName')).toEqual({ name: 'UserName', type: 'Edm.String', nullable: false, primaryKey: true });
    expect(people.columns.find((c) => c.name === 'Emails')?.type).toBe('Collection(Edm.String)');
    expect(people.navigationProperties).toEqual([
      { name: 'BestFriend', targetEntityType: 'Microsoft.OData.SampleService.Models.TripPin.Person', targetEntitySet: 'People', nullable: true },
      { name: 'Photo', targetEntityType: 'Microsoft.OData.SampleService.Models.TripPin.Photo', targetEntitySet: 'Photos', nullable: true },
    ]);
    expect(schema.tables.Flights!.columns.filter((c) => c.primaryKey).map((c) => c.name)).toEqual(['PlanItemId']);
  });
});

describe('credentials', () => {
  it('sends the resolved secret as a bearer token, and resolves again once after a 401', async () => {
    let calls = 0;
    const secrets = ['expired-token', 'rotated-token'];
    const { driver, requests } = driverFor(
      [
        { url: 'People', status: 401, once: true },
        { url: 'People', body: page([]) },
      ],
      { auth: { scheme: 'bearer' }, credential: async () => secrets[calls++] },
    );
    await driver.find('trip_person', {});
    const peopleRequests = requests.filter((r) => r.url === 'People');
    expect(peopleRequests.map((r) => r.headers.Authorization)).toEqual(['Bearer expired-token', 'Bearer rotated-token']);
  });

  it('refuses to send a request when the scheme needs a credential and none resolves', async () => {
    const { driver, requests } = driverFor([], { auth: { scheme: 'bearer' }, credential: async () => undefined });
    await expect(driver.find('trip_person', {})).rejects.toThrow(/resolved to nothing/);
    expect(requests).toHaveLength(0);
  });
});
