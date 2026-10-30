// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The driver with `version: '2.0'` against a recorded Northwind-shaped v2
 * service: each test names the exact requests the driver sends and answers
 * them from recordings in the v2 verbose JSON envelope.
 */

import { describe, expect, it } from 'vitest';
import { parseODataDriverConfig } from './config.js';
import { ODataDriver } from './odata-driver.js';
import { ODataRequestError } from './transport.js';
import { recordedService, type Exchange } from './__fixtures__/recorded-service.js';
import {
  NORTHWIND_V2_METADATA_EXCHANGE,
  NORTHWIND_V2_ROOT,
  ORDERS_V2,
  PRODUCTS_V2,
  SHIPMENT_LEG_V2,
  SHIPMENT_V2,
  TRACKING_ID,
  entityV2,
  pageV2,
} from './__fixtures__/recorded-service-v2.js';

const PRODUCT = {
  name: 'product',
  external: {
    remoteName: 'Products',
    columnMap: {
      ProductID: 'product_id', ProductName: 'product_name', SupplierID: 'supplier_id',
      CategoryID: 'category_id', UnitPrice: 'unit_price', Discontinued: 'discontinued',
    },
  },
};
const ORDER = { name: 'order', external: { remoteName: 'Orders' } };
const SHIPMENT = { name: 'shipment', external: { remoteName: 'Shipments' } };
const LEG = { name: 'shipment_leg', external: { remoteName: 'ShipmentLegs' } };

function driverFor(exchanges: Exchange[]) {
  const service = recordedService([NORTHWIND_V2_METADATA_EXCHANGE, ...exchanges], NORTHWIND_V2_ROOT);
  const config = parseODataDriverConfig({ name: 'northwind', serviceRoot: NORTHWIND_V2_ROOT, version: '2.0', pageSize: 2 });
  const driver = new ODataDriver(config, { fetch: service.fetch });
  for (const object of [PRODUCT, ORDER, SHIPMENT, LEG]) driver.registerExternalObject(object);
  return { driver, requests: service.requests };
}

const urls = (requests: { method: string; url: string }[]) =>
  requests.filter((r) => r.url !== '$metadata').map((r) => `${r.method} ${r.url}`);

describe('version selection', () => {
  it('accepts version 2.0 beside the default 4.0, and nothing else', () => {
    expect(parseODataDriverConfig({ serviceRoot: NORTHWIND_V2_ROOT, version: '2.0' }).version).toBe('2.0');
    expect(parseODataDriverConfig({ serviceRoot: NORTHWIND_V2_ROOT }).version).toBe('4.0');
    expect(() => parseODataDriverConfig({ serviceRoot: NORTHWIND_V2_ROOT, version: '3.0' as never })).toThrow(/version/);
  });

  it('reads $metadata as EDMX 1.0 and sends every request under DataServiceVersion 2.0', async () => {
    const { driver, requests } = driverFor([{ url: 'Products', body: pageV2([]) }]);
    await driver.find('product', {});
    expect(requests[0]!.url).toBe('$metadata');
    expect(requests[1]!.headers).toMatchObject({ DataServiceVersion: '2.0', MaxDataServiceVersion: '2.0', Accept: 'application/json' });
    expect(requests[1]!.headers['OData-Version']).toBeUndefined();
  });
});

describe('reads', () => {
  it('reads d.results, renames through the column map, drops __metadata and the __deferred stubs, and sets id to the key', async () => {
    const { driver, requests } = driverFor([
      { url: "Products?$filter=substringof('Chef',ProductName)", body: pageV2([PRODUCTS_V2[3]]) },
    ]);
    const rows = await driver.find('product', { where: { product_name: { $contains: 'Chef' } } });
    expect(urls(requests)).toEqual(["GET Products?$filter=substringof('Chef',ProductName)"]);
    expect(rows).toEqual([{
      id: '4', product_id: 4, product_name: "Chef Anton's Cajun Seasoning", supplier_id: 2, category_id: 2,
      unit_price: 22, discontinued: false,
    }]);
  });

  it('reads Edm.DateTime as the UTC instant and Edm.Decimal as a number', async () => {
    const { driver } = driverFor([{ url: 'Orders', body: pageV2(ORDERS_V2) }]);
    const [first] = await driver.find('order', {});
    expect(first).toMatchObject({
      id: '10248', OrderDate: '1996-07-04T00:00:00.000Z', ShippedDate: '1996-07-16T00:00:00.000Z', Freight: 32.38,
    });
  });

  it('reads an Edm.DateTime under a field the object declares `date` as its date', async () => {
    const { driver } = driverFor([{ url: 'Orders', body: pageV2(ORDERS_V2) }]);
    driver.registerExternalObject({ ...ORDER, fields: { OrderDate: { type: 'date' }, ShippedDate: { type: 'datetime' } } });
    const [first] = await driver.find('order', {});
    expect(first).toMatchObject({ OrderDate: '1996-07-04', ShippedDate: '1996-07-16T00:00:00.000Z' });
  });

  it('pushes the v2 typed literals down: datetime, Decimal M, substringof under tolower', async () => {
    const { driver, requests } = driverFor([
      {
        url: "Orders?$filter=(OrderDate ge datetime'1996-07-05T00:00:00.000') and (Freight lt 20M)",
        body: pageV2([ORDERS_V2[1]]),
      },
      { url: "Products?$filter=substringof('chef',tolower(ProductName))", body: pageV2([PRODUCTS_V2[3], PRODUCTS_V2[4]]) },
    ]);
    const orders = await driver.find('order', { where: { OrderDate: { $gte: '1996-07-05T00:00:00Z' }, Freight: { $lt: 20 } } });
    expect(orders.map((r) => r.id)).toEqual(['10249']);
    const products = await driver.find('product', { where: { product_name: { $icontains: 'CHEF' } } });
    expect(products.map((r) => r.id)).toEqual(['4', '5']);
    expect(urls(requests)).toEqual([
      "GET Orders?$filter=(OrderDate ge datetime'1996-07-05T00:00:00.000') and (Freight lt 20M)",
      "GET Products?$filter=substringof('chef',tolower(ProductName))",
    ]);
  });

  it('leaves a zone-less date comparand on Edm.DateTime to the engine rather than giving it a zone', async () => {
    const { driver, requests } = driverFor([{ url: 'Orders', body: pageV2(ORDERS_V2) }]);
    await driver.find('order', { where: { OrderDate: { $gte: '1996-07-05' } } });
    expect(urls(requests)).toEqual(['GET Orders']);
  });

  it('follows __next until the limit, ordered by the key', async () => {
    const { driver, requests } = driverFor([
      {
        url: 'Products?$orderby=ProductID asc&$top=3',
        body: pageV2(PRODUCTS_V2.slice(0, 2), { __next: `${NORTHWIND_V2_ROOT}Products?$orderby=ProductID asc&$top=3&$skiptoken=2` }),
      },
      { url: 'Products?$orderby=ProductID asc&$top=3&$skiptoken=2', body: pageV2(PRODUCTS_V2.slice(2, 4)) },
    ]);
    const rows = await driver.find('product', { limit: 3 });
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(urls(requests)).toEqual([
      'GET Products?$orderby=ProductID asc&$top=3',
      'GET Products?$orderby=ProductID asc&$top=3&$skiptoken=2',
    ]);
  });

  it('counts with $inlinecount=allpages and reads the string __count', async () => {
    const { driver, requests } = driverFor([
      { url: 'Products?$inlinecount=allpages&$top=0&$filter=Discontinued eq true', body: pageV2([], { __count: '8' }) },
    ]);
    expect(await driver.count('product', { where: { discontinued: true } })).toBe(8);
    expect(urls(requests)).toEqual(['GET Products?$inlinecount=allpages&$top=0&$filter=Discontinued eq true']);
  });

  it('answers a refused read with the v2 error body\'s { lang, value } message', async () => {
    const { driver } = driverFor([
      {
        url: "Products?$filter=ProductName eq 'x'",
        status: 400,
        body: { error: { code: '', message: { lang: 'en-US', value: 'Syntax error at position 12.' } } },
      },
    ]);
    const error = await driver.find('product', { where: { product_name: 'x' } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ODataRequestError);
    expect((error as Error).message).toBe("OData service refused GET on 'Products' (HTTP 400): Syntax error at position 12.");
  });
});

describe('keys', () => {
  it('spells a Guid key as guid\'…\', keeps an Int64 beyond the safe range as text, reads Edm.Time as a time of day', async () => {
    const { driver, requests } = driverFor([
      { url: `Shipments?$filter=TrackingId eq guid'${TRACKING_ID}'`, body: pageV2([SHIPMENT_V2]) },
    ]);
    const [row] = await driver.find('shipment', { where: { id: TRACKING_ID } });
    expect(row).toMatchObject({
      id: TRACKING_ID, Sequence: '9007199254740993', Weight: 12.5, Volume: 0.75,
      DispatchedAt: '2024-03-01T10:00:00Z', PickupWindow: '13:20:00', Label: 'Pallet 7',
    });
    expect(urls(requests)).toEqual([`GET Shipments?$filter=TrackingId eq guid'${TRACKING_ID}'`]);
  });

  it('writes a composite key with typed literals and reads it back into the same predicate', async () => {
    const predicate = `TrackingId=guid'${TRACKING_ID}',Leg=2L`;
    const { driver, requests } = driverFor([
      { url: `ShipmentLegs?$filter=Destination eq 'Rotterdam'`, body: pageV2([SHIPMENT_LEG_V2]) },
      { method: 'DELETE', url: `ShipmentLegs(${predicate})`, status: 204 },
    ]);
    const [leg] = await driver.find('shipment_leg', { where: { Destination: 'Rotterdam' } });
    expect(leg!.id).toBe(predicate);
    expect(leg!.Leg).toBe(2);
    expect(await driver.delete('shipment_leg', leg!.id as string)).toBe(true);
    expect(urls(requests)).toContain(`DELETE ShipmentLegs(${predicate})`);
  });
});

describe('writes', () => {
  it('updates with MERGE tunnelled through POST, carrying the __metadata ETag, then re-reads the 204', async () => {
    const updated = { ...SHIPMENT_V2, Label: 'Pallet 8' };
    const { driver, requests } = driverFor([
      { url: `Shipments?$filter=TrackingId eq guid'${TRACKING_ID}'`, body: pageV2([SHIPMENT_V2]) },
      { method: 'POST', url: `Shipments(guid'${TRACKING_ID}')`, status: 204 },
      { url: `Shipments(guid'${TRACKING_ID}')`, body: entityV2(updated) },
    ]);
    await driver.find('shipment', { where: { id: TRACKING_ID } });
    const row = await driver.update('shipment', TRACKING_ID, { Label: 'Pallet 8', PickupWindow: '14:00', Sequence: 3 });
    expect(row).toMatchObject({ id: TRACKING_ID, Label: 'Pallet 8' });
    const merge = requests.find((r) => r.method === 'POST')!;
    expect(merge.url).toBe(`Shipments(guid'${TRACKING_ID}')`);
    expect(merge.headers['X-HTTP-Method']).toBe('MERGE');
    expect(merge.headers['If-Match']).toBe(SHIPMENT_V2.__metadata.etag);
    expect(merge.body).toEqual({ Label: 'Pallet 8', PickupWindow: 'PT14H0M0S', Sequence: '3' });
  });

  it('creates with POST, writing Edm.DateTime as /Date(ms)/ and Edm.Decimal as a string, and reads the d entity back', async () => {
    const created = { ...ORDERS_V2[0], OrderID: 11078 };
    const { driver, requests } = driverFor([{ method: 'POST', url: 'Orders', status: 201, body: entityV2(created) }]);
    const row = await driver.create('order', { OrderID: 11078, OrderDate: '1996-07-04', Freight: 32.38, ShipName: 'x' });
    expect(row).toMatchObject({ id: '11078', OrderDate: '1996-07-04T00:00:00.000Z', Freight: 32.38 });
    expect(requests.find((r) => r.method === 'POST')!.body).toEqual({
      OrderID: 11078, OrderDate: '/Date(836438400000)/', Freight: '32.38', ShipName: 'x',
    });
  });
});

describe('introspection', () => {
  it('lists the entity sets under dialect odata-2.0, with v2 types and Association-backed lookup candidates', async () => {
    const { driver } = driverFor([]);
    const schema = await driver.introspectSchema();
    expect(schema.dialect).toBe('odata-2.0');
    expect(schema.tables.Orders!.columns.find((c) => c.name === 'OrderDate')).toEqual({
      name: 'OrderDate', type: 'Edm.DateTime', nullable: true, primaryKey: false,
    });
    expect(schema.tables.Products!.navigationProperties).toEqual([
      {
        name: 'Category', targetEntityType: 'NorthwindModel.Category', targetEntitySet: 'Categories', nullable: true,
        referentialConstraints: [{ property: 'CategoryID', referencedProperty: 'CategoryID' }],
      },
      {
        name: 'Supplier', targetEntityType: 'NorthwindModel.Supplier', targetEntitySet: 'Suppliers', nullable: true,
        referentialConstraints: [{ property: 'SupplierID', referencedProperty: 'SupplierID' }],
      },
    ]);
  });
});
