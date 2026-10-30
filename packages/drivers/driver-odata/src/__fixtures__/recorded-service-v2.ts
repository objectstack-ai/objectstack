// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Recordings of an OData v2 service shaped like the public "Northwind" v2
 * reference service (services.odata.org/V2/Northwind/Northwind.svc), for the
 * v2 dialect: its EDMX 1.0 `$metadata` (`northwind-v2-metadata.xml`) and its
 * verbose JSON answers — the `d` envelope, `__metadata` on every entity, a
 * `{ __deferred }` stub per navigation property, `Edm.Decimal` as a string and
 * `Edm.DateTime` as `/Date(ms)/`. The exchanges are served by
 * {@link recordedService}, written relative to {@link NORTHWIND_V2_ROOT}.
 */

import { readFileSync } from 'node:fs';
import type { Exchange } from './recorded-service.js';

export const NORTHWIND_V2_ROOT = 'https://odata.example.test/V2/Northwind/Northwind.svc/';

export const NORTHWIND_V2_METADATA = readFileSync(new URL('./northwind-v2-metadata.xml', import.meta.url), 'utf8');

export const NORTHWIND_V2_METADATA_EXCHANGE: Exchange = {
  url: '$metadata',
  body: NORTHWIND_V2_METADATA,
  headers: { 'Content-Type': 'application/xml;charset=utf-8', DataServiceVersion: '1.0;' },
};

const deferred = (set: string, key: string, navigation: string) =>
  ({ __deferred: { uri: `${NORTHWIND_V2_ROOT}${set}(${key})/${navigation}` } });

/** One Product as the service writes it. */
function product(id: number, name: string, supplier: number, category: number, price: string, discontinued: boolean) {
  return {
    __metadata: { uri: `${NORTHWIND_V2_ROOT}Products(${id})`, type: 'NorthwindModel.Product' },
    ProductID: id, ProductName: name, SupplierID: supplier, CategoryID: category, UnitPrice: price, Discontinued: discontinued,
    Category: deferred('Products', String(id), 'Category'),
    Order_Details: deferred('Products', String(id), 'Order_Details'),
    Supplier: deferred('Products', String(id), 'Supplier'),
  };
}

/** Northwind's first five Products (abridged to the properties the fixture's `$metadata` keeps). */
export const PRODUCTS_V2 = [
  product(1, 'Chai', 1, 1, '18.0000', false),
  product(2, 'Chang', 1, 1, '19.0000', false),
  product(3, 'Aniseed Syrup', 1, 2, '10.0000', false),
  product(4, "Chef Anton's Cajun Seasoning", 2, 2, '22.0000', false),
  product(5, "Chef Anton's Gumbo Mix", 2, 2, '21.3500', true),
] as const;

/** Northwind's first two Orders: `Edm.DateTime` as `/Date(ms)/`, `Edm.Decimal` as a string. */
export const ORDERS_V2 = [
  {
    __metadata: { uri: `${NORTHWIND_V2_ROOT}Orders(10248)`, type: 'NorthwindModel.Order' },
    OrderID: 10248, CustomerID: 'VINET', EmployeeID: 5,
    OrderDate: '/Date(836438400000)/', ShippedDate: '/Date(837475200000)/', Freight: '32.3800',
    ShipName: 'Vins et alcools Chevalier',
    Employee: deferred('Orders', '10248', 'Employee'),
    Order_Details: deferred('Orders', '10248', 'Order_Details'),
  },
  {
    __metadata: { uri: `${NORTHWIND_V2_ROOT}Orders(10249)`, type: 'NorthwindModel.Order' },
    OrderID: 10249, CustomerID: 'TOMSP', EmployeeID: 6,
    OrderDate: '/Date(836524800000)/', ShippedDate: '/Date(836956800000)/', Freight: '11.6100',
    ShipName: 'Toms Spezialitäten',
    Employee: deferred('Orders', '10249', 'Employee'),
    Order_Details: deferred('Orders', '10249', 'Order_Details'),
  },
] as const;

export const TRACKING_ID = '6f1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';

/** The fixture's own Shipment: a Guid key, `Edm.Int64` as a string, an ETag in `__metadata`. */
export const SHIPMENT_V2 = {
  __metadata: {
    uri: `${NORTHWIND_V2_ROOT}Shipments(guid'${TRACKING_ID}')`,
    type: 'NorthwindModel.Shipment',
    etag: 'W/"datetime\'2024-03-01T10%3A00%3A00\'"',
  },
  TrackingId: TRACKING_ID, Sequence: '9007199254740993', Weight: 12.5, Volume: 0.75,
  DispatchedAt: '2024-03-01T10:00:00Z', PickupWindow: 'PT13H20M', Label: 'Pallet 7',
  Legs: deferred('Shipments', `guid'${TRACKING_ID}'`, 'Legs'),
};

/** The fixture's own ShipmentLeg: a composite (Guid, Int64) key. */
export const SHIPMENT_LEG_V2 = {
  __metadata: {
    uri: `${NORTHWIND_V2_ROOT}ShipmentLegs(TrackingId=guid'${TRACKING_ID}',Leg=2L)`,
    type: 'NorthwindModel.ShipmentLeg',
  },
  TrackingId: TRACKING_ID, Leg: '2', Destination: 'Rotterdam',
  Shipment: deferred('ShipmentLegs', `TrackingId=guid'${TRACKING_ID}',Leg=2L`, 'Shipment'),
};

/** A v2 collection answer: `{ d: { results, __count?, __next? } }`. */
export function pageV2(rows: readonly unknown[], extra: { __count?: string; __next?: string } = {}): Record<string, unknown> {
  return { d: { results: rows, ...extra } };
}

/** A v2 single-entity answer: `{ d: entity }`. */
export function entityV2(entity: unknown): Record<string, unknown> {
  return { d: entity };
}
