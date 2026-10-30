// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { odataV2Dialect, parseCsdlV2 } from './dialect-v2.js';
import type { EdmProperty } from './dialect.js';
import { TRIPPIN_METADATA } from './__fixtures__/recorded-service.js';
import { NORTHWIND_V2_METADATA, PRODUCTS_V2, SHIPMENT_V2 } from './__fixtures__/recorded-service-v2.js';

const NS = 'NorthwindModel';
const model = parseCsdlV2(NORTHWIND_V2_METADATA);
const prop = (type: string, isCollection = false): EdmProperty => ({ name: 'P', type, isCollection, nullable: true });

describe('EDMX 1.0 (CSDL v2) $metadata reader', () => {
  it('reads entity sets across schemas, with their qualified entity type and the DataServiceVersion', () => {
    expect(model.version).toBe('1.0');
    expect([...model.entitySets.keys()]).toEqual([
      'Categories', 'Employees', 'Order_Details', 'Orders', 'Products', 'Suppliers', 'Shipments', 'ShipmentLegs',
    ]);
    expect(model.entitySets.get('Products')?.entityType).toBe(`${NS}.Product`);
    expect(model.enumTypes.size).toBe(0);
  });

  it('reads keys, the v2 property types and nullability', () => {
    expect(model.entityTypes.get(`${NS}.Order_Detail`)?.key).toEqual(['OrderID', 'ProductID']);
    const order = model.entityTypes.get(`${NS}.Order`)!;
    expect(order.properties.find((p) => p.name === 'OrderDate')).toEqual({ name: 'OrderDate', type: 'Edm.DateTime', isCollection: false, nullable: true });
    expect(order.properties.find((p) => p.name === 'OrderID')?.nullable).toBe(false);
    const shipment = model.entityTypes.get(`${NS}.Shipment`)!;
    expect(shipment.properties.map((p) => p.type)).toEqual([
      'Edm.Guid', 'Edm.Int64', 'Edm.Double', 'Edm.Single', 'Edm.DateTimeOffset', 'Edm.Time', 'Edm.String',
    ]);
  });

  it('reads a navigation through its Association: the target type and cardinality from the ToRole end', () => {
    const product = model.entityTypes.get(`${NS}.Product`)!;
    expect(product.navigationProperties.map((n) => [n.name, n.type, n.isCollection, n.nullable])).toEqual([
      ['Category', `${NS}.Category`, false, true],
      ['Order_Details', `${NS}.Order_Detail`, true, true],
      ['Supplier', `${NS}.Supplier`, false, true],
    ]);
    // Multiplicity "1" on the target end: not nullable.
    const line = model.entityTypes.get(`${NS}.Order_Detail`)!;
    expect(line.navigationProperties.find((n) => n.name === 'Product')).toMatchObject({ isCollection: false, nullable: false });
  });

  it('gives the dependent end the ReferentialConstraint as v4 writes it: this property → the target\'s', () => {
    const product = model.entityTypes.get(`${NS}.Product`)!;
    expect(product.navigationProperties.find((n) => n.name === 'Category')?.referentialConstraints)
      .toEqual([{ property: 'CategoryID', referencedProperty: 'CategoryID' }]);
    expect(product.navigationProperties.find((n) => n.name === 'Supplier')?.referentialConstraints)
      .toEqual([{ property: 'SupplierID', referencedProperty: 'SupplierID' }]);
    // The principal end carries none: its own key is not a foreign key.
    const category = model.entityTypes.get(`${NS}.Category`)!;
    expect(category.navigationProperties.find((n) => n.name === 'Products')?.referentialConstraints).toEqual([]);
  });

  it('reads a self-association by its roles: the manager navigation holds ReportsTo, the reports one holds nothing', () => {
    const employee = model.entityTypes.get(`${NS}.Employee`)!;
    expect(employee.navigationProperties.find((n) => n.name === 'Employee1')).toEqual({
      name: 'Employee1', type: `${NS}.Employee`, isCollection: false, nullable: true,
      referentialConstraints: [{ property: 'ReportsTo', referencedProperty: 'EmployeeID' }],
    });
    expect(employee.navigationProperties.find((n) => n.name === 'Employees1')).toMatchObject({ isCollection: true, referentialConstraints: [] });
  });

  it('binds each navigation to its target entity set through the AssociationSets', () => {
    expect(model.entitySets.get('Products')?.navigationBindings).toEqual({
      Category: 'Categories', Order_Details: 'Order_Details', Supplier: 'Suppliers',
    });
    expect(model.entitySets.get('Employees')?.navigationBindings).toEqual({
      Employees1: 'Employees', Employee1: 'Employees', Orders: 'Orders',
    });
    expect(model.entitySets.get('ShipmentLegs')?.navigationBindings).toEqual({ Shipment: 'Shipments' });
  });

  it('refuses a v4 (CSDL 4.0) document by name, pointing at the version that reads it', () => {
    expect(() => parseCsdlV2(TRIPPIN_METADATA)).toThrow(/not EDMX 1\.0 .*Version="4\.0".*version: '4\.0'/);
  });

  it('refuses a document that is not XML', () => {
    expect(() => parseCsdlV2('{"d":[]}')).toThrow(/not EDMX 1\.0/);
  });
});

describe('the v2 verbose JSON envelope', () => {
  it('reads d.results, the string __count and __next, and drops each navigation\'s __deferred stub', () => {
    const page = odataV2Dialect.readCollection({ d: { results: [PRODUCTS_V2[0]], __count: '77', __next: 'https://x/Products?$skiptoken=1' } });
    expect(page.count).toBe(77);
    expect(page.nextLink).toBe('https://x/Products?$skiptoken=1');
    expect(Object.keys(page.rows[0]!)).toEqual([
      '__metadata', 'ProductID', 'ProductName', 'SupplierID', 'CategoryID', 'UnitPrice', 'Discontinued',
    ]);
  });

  it('reads a 1.0 service\'s bare d array', () => {
    expect(odataV2Dialect.readCollection({ d: [{ A: 1 }] })).toEqual({ rows: [{ A: 1 }] });
  });

  it('refuses a v4 envelope rather than reading no rows', () => {
    expect(() => odataV2Dialect.readCollection({ value: [] })).toThrow(/without a `d.results` array/);
  });

  it('reads one entity out of d, and its ETag out of __metadata', () => {
    const entity = odataV2Dialect.readEntity({ d: SHIPMENT_V2 });
    expect(entity.Legs).toBeUndefined();
    expect(odataV2Dialect.etagOf(entity)).toBe(SHIPMENT_V2.__metadata.etag);
    expect(odataV2Dialect.isAnnotation('__metadata')).toBe(true);
    expect(odataV2Dialect.isAnnotation('Label')).toBe(false);
    expect(() => odataV2Dialect.readEntity({ value: [] })).toThrow(/without a `d` entity/);
  });

  it('reads the v2 error body, whose message is { lang, value }', () => {
    expect(odataV2Dialect.readError({ error: { code: 'BadRequest', message: { lang: 'en-US', value: 'Syntax error.' } } }))
      .toEqual({ code: 'BadRequest', message: 'Syntax error.' });
    expect(odataV2Dialect.readError({ error: { code: '', message: 'plain' } })).toEqual({ message: 'plain' });
  });

  it('asks for verbose JSON under DataServiceVersion 2.0, and counts with $inlinecount', () => {
    expect(odataV2Dialect.requestHeaders()).toEqual({ DataServiceVersion: '2.0', MaxDataServiceVersion: '2.0', Accept: 'application/json' });
    expect(odataV2Dialect.countOptions()).toEqual({ $inlinecount: 'allpages' });
  });
});

describe('v2 literals', () => {
  const lit = (value: unknown, type: string) => odataV2Dialect.literal(value, type, model);

  it('spells each typed literal of the v2 URI conventions', () => {
    expect(lit("O'Neil", 'Edm.String')).toBe("'O''Neil'");
    expect(lit(true, 'Edm.Boolean')).toBe('true');
    expect(lit(7, 'Edm.Int32')).toBe('7');
    expect(lit(7, 'Edm.Int16')).toBe('7');
    expect(lit(7, 'Edm.Int64')).toBe('7L');
    expect(lit('9007199254740993', 'Edm.Int64')).toBe('9007199254740993L');
    expect(lit(1.5, 'Edm.Decimal')).toBe('1.5M');
    expect(lit('21.3500', 'Edm.Decimal')).toBe('21.3500M');
    expect(lit(1.5, 'Edm.Double')).toBe('1.5d');
    expect(lit(2, 'Edm.Double')).toBe('2d');
    expect(lit(0.75, 'Edm.Single')).toBe('0.75f');
    expect(lit('6f1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b', 'Edm.Guid')).toBe("guid'6f1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b'");
    expect(lit('2024-03-01T10:00:00Z', 'Edm.DateTimeOffset')).toBe("datetimeoffset'2024-03-01T10:00:00Z'");
    expect(lit('13:20', 'Edm.Time')).toBe("time'PT13H20M0S'");
    expect(lit('13:20:05.5', 'Edm.Time')).toBe("time'PT13H20M5.5S'");
    expect(lit(null, 'Edm.DateTime')).toBe('null');
  });

  it('spells an Edm.DateTime comparand as its instant\'s UTC wall clock, and only one that names its instant', () => {
    expect(lit('2024-03-01T10:00:00Z', 'Edm.DateTime')).toBe("datetime'2024-03-01T10:00:00.000'");
    expect(lit('2024-03-01T12:00:00+02:00', 'Edm.DateTime')).toBe("datetime'2024-03-01T10:00:00.000'");
    expect(lit(new Date('2024-03-01T10:00:00Z'), 'Edm.DateTime')).toBe("datetime'2024-03-01T10:00:00.000'");
    // A bare date or a zone-less date-time is left to the engine, not given a zone here.
    expect(lit('2024-03-01', 'Edm.DateTime')).toBeUndefined();
    expect(lit('2024-03-01T10:00:00', 'Edm.DateTime')).toBeUndefined();
  });

  it('refuses what cannot be spelled as the type, rather than coercing', () => {
    expect(lit(1.5, 'Edm.Int64')).toBeUndefined();
    expect(lit(1e21, 'Edm.Decimal')).toBeUndefined();
    expect(lit('abc', 'Edm.Guid')).toBeUndefined();
    expect(lit('25:00', 'Edm.Time')).toBeUndefined();
    expect(lit('2024-03-01T10:00:00', 'Edm.DateTimeOffset')).toBeUndefined();
    expect(lit('x', 'Edm.Binary')).toBeUndefined();
  });

  it('spells contains as substringof, needle first; startswith and endswith as v4 does', () => {
    expect(odataV2Dialect.stringFunction('contains', 'ProductName', "'Chef'")).toBe("substringof('Chef',ProductName)");
    expect(odataV2Dialect.stringFunction('startswith', 'ProductName', "'Ch'")).toBe("startswith(ProductName,'Ch')");
    expect(odataV2Dialect.stringFunction('endswith', 'ProductName', "'ix'")).toBe("endswith(ProductName,'ix')");
    expect(odataV2Dialect.inList('ProductID', ['1', '2'])).toBe('ProductID eq 1 or ProductID eq 2');
  });

  it('reads a key literal back to the value it spells again', () => {
    for (const [value, type] of [
      [7, 'Edm.Int64'], ['6f1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b', 'Edm.Guid'], ['2024-03-01T10:00:00.000Z', 'Edm.DateTime'],
      ['2024-03-01T10:00:00Z', 'Edm.DateTimeOffset'], ['13:20:00', 'Edm.Time'], ["O'Neil", 'Edm.String'], [1.5, 'Edm.Decimal'], [3, 'Edm.Int32'],
    ] as const) {
      const spelled = lit(value, type)!;
      expect(lit(odataV2Dialect.keyValue!(spelled, type), type), `${type} ${spelled}`).toBe(spelled);
    }
  });
});

describe('v2 values', () => {
  const read = (value: unknown, type: string) => odataV2Dialect.readValue!(value, prop(type));
  const write = (value: unknown, type: string) => odataV2Dialect.writeValue!(value, prop(type));

  it('reads /Date(ms)/ as the UTC instant, Int64 and Decimal strings as numbers, Edm.Time as the time of day', () => {
    expect(read('/Date(836438400000)/', 'Edm.DateTime')).toBe('1996-07-04T00:00:00.000Z');
    expect(read('/Date(-664761600000)/', 'Edm.DateTime')).toBe('1948-12-08T00:00:00.000Z');
    expect(read('/Date(1709287200000+0060)/', 'Edm.DateTimeOffset')).toBe('2024-03-01T10:00:00.000Z');
    expect(read('2024-03-01T10:00:00Z', 'Edm.DateTimeOffset')).toBe('2024-03-01T10:00:00Z');
    expect(read('42', 'Edm.Int64')).toBe(42);
    expect(read('21.3500', 'Edm.Decimal')).toBe(21.35);
    expect(read('PT13H20M', 'Edm.Time')).toBe('13:20:00');
    expect(read('PT9H5M7.25S', 'Edm.Time')).toBe('09:05:07.25');
    expect(read(null, 'Edm.DateTime')).toBeNull();
  });

  it('reads an Edm.DateTime under a field declared `date` as its UTC date: v2 has no Edm.Date', () => {
    expect(odataV2Dialect.readValue!('/Date(-664761600000)/', prop('Edm.DateTime'), 'date')).toBe('1948-12-08');
    expect(odataV2Dialect.readValue!('/Date(-664761600000)/', prop('Edm.DateTime'), 'datetime')).toBe('1948-12-08T00:00:00.000Z');
  });

  it('keeps what it cannot read losslessly as written', () => {
    expect(read('9007199254740993', 'Edm.Int64')).toBe('9007199254740993');
    expect(read('P1DT2H', 'Edm.Time')).toBe('P1DT2H');
    expect(read('not a date', 'Edm.DateTime')).toBe('not a date');
    expect(read('Chai', 'Edm.String')).toBe('Chai');
  });

  it('writes the v2 JSON forms: /Date(ms)/ read as UTC, Int64 and Decimal as strings, a time as a duration', () => {
    expect(write('1996-07-04T00:00:00.000Z', 'Edm.DateTime')).toBe('/Date(836438400000)/');
    expect(write('1996-07-04', 'Edm.DateTime')).toBe('/Date(836438400000)/');
    expect(write('1996-07-04T00:00:00', 'Edm.DateTime')).toBe('/Date(836438400000)/');
    expect(write(new Date(836438400000), 'Edm.DateTime')).toBe('/Date(836438400000)/');
    expect(write(42, 'Edm.Int64')).toBe('42');
    expect(write(21.35, 'Edm.Decimal')).toBe('21.35');
    expect(write('13:20', 'Edm.Time')).toBe('PT13H20M0S');
    expect(write(new Date('2024-03-01T10:00:00Z'), 'Edm.DateTimeOffset')).toBe('2024-03-01T10:00:00.000Z');
    expect(write(12.5, 'Edm.Double')).toBe(12.5);
    expect(write(null, 'Edm.DateTime')).toBeNull();
  });

  it('updates with MERGE tunnelled through POST', () => {
    expect(odataV2Dialect.updateRequest!()).toEqual({ method: 'POST', headers: { 'X-HTTP-Method': 'MERGE' } });
  });
});
