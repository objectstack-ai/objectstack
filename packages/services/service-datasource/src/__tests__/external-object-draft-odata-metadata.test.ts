// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `generateObjectDraft` / `importObject` for an OData datasource, driven off a
 * REAL `ODataDriver.introspectSchema()` over a recorded `$metadata` document
 * (`__fixtures__/northwind-metadata.xml`), not a hand-written schema.
 *
 * What an OData draft has to get right that a SQL one never met:
 *
 *  - **EDM types.** The driver reports each column under its EDM name
 *    (`Edm.Int32`) and its dialect as `odata-4.0`; the type matrix reads them
 *    through its `odata` arm. Without it every column drafted as `text` and
 *    Gate 2 refused the saved object.
 *  - **Field names.** OData properties are PascalCase and `ObjectSchema`
 *    admits snake_case field keys only, so each field is the property's
 *    snake_case name and `external.columnMap` carries the remote spelling.
 *  - **Lookups.** A single-valued navigation becomes a `lookup` on the column
 *    its `ReferentialConstraint` names, when the target is imported; every
 *    other navigation is left out of the draft and named in its review.
 *
 * `@objectstack/driver-odata` resolves to the driver's `src/` through this
 * package's vitest alias, so the draft is judged against the introspection in
 * the checkout, not a build of it.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ODataDriver, parseODataDriverConfig, type FetchLike } from '@objectstack/driver-odata';
import { ObjectSchema } from '@objectstack/spec/data';
import {
  ExternalDatasourceService,
  type DatasourceLike,
  type ObjectLike,
} from '../external-datasource-service.js';

const SERVICE_ROOT = 'https://odata.example.test/V4/Northwind/Northwind.svc/';
const NORTHWIND_METADATA = readFileSync(new URL('./__fixtures__/northwind-metadata.xml', import.meta.url), 'utf8');

/** A service that answers `$metadata` and records every other request. */
function northwind(answers: Record<string, unknown> = {}): { fetch: FetchLike; requests: string[] } {
  const requests: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = decodeURIComponent(input).slice(SERVICE_ROOT.length);
    requests.push(url);
    if (url === '$metadata') {
      return new Response(NORTHWIND_METADATA, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    if (url in answers) {
      return new Response(JSON.stringify(answers[url]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`northwind fixture: no answer recorded for GET ${url}`);
  };
  return { fetch, requests };
}

function driverFor(answers?: Record<string, unknown>) {
  const service = northwind(answers);
  const driver = new ODataDriver(parseODataDriverConfig({ name: 'erp', serviceRoot: SERVICE_ROOT }), { fetch: service.fetch });
  return { driver, requests: service.requests };
}

/** The service over the real driver, with `objects` as the registry and every save recorded. */
function serviceOver(objects: ObjectLike[] = []) {
  const { driver } = driverFor();
  const saved: Array<{ name: string; definition: Record<string, unknown> }> = [];
  const registry = [...objects];
  const service = new ExternalDatasourceService({
    introspect: () => driver.introspectSchema(),
    getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
    getObject: async (name) => registry.find((o) => o.name === name),
    listObjects: async () => registry,
    persistObject: async (name, definition) => {
      saved.push({ name, definition });
      registry.push(definition as unknown as ObjectLike);
    },
  });
  return { service, saved, registry };
}

const imported = (name: string, remoteName: string, datasource = 'erp'): ObjectLike => ({
  name,
  datasource,
  external: { remoteName },
});

describe('an OData entity set drafts with EDM types mapped and snake_case fields bound by columnMap', () => {
  it('maps every EDM primitive the fixture uses through the matrix\'s odata arm', async () => {
    const { service } = serviceOver();
    const draft = await service.generateObjectDraft('erp', 'Products');

    expect(draft.name).toBe('products');
    expect(draft.definition.fields).toEqual({
      product_id: { type: 'number' },
      product_name: { type: 'text' },
      supplier_id: { type: 'number' },
      category_id: { type: 'number' },
      unit_price: { type: 'number' },
      discontinued: { type: 'boolean' },
    });
    expect(draft.definition.external).toEqual({
      remoteName: 'Products',
      columnMap: {
        ProductID: 'product_id',
        ProductName: 'product_name',
        SupplierID: 'supplier_id',
        CategoryID: 'category_id',
        UnitPrice: 'unit_price',
        Discontinued: 'discontinued',
      },
    });

    const categories = await service.generateObjectDraft('erp', 'Categories');
    expect(categories.definition.fields).toMatchObject({
      category_id: { type: 'number' },
      description: { type: 'text' },
      picture: { type: 'file' },
    });
    const employees = await service.generateObjectDraft('erp', 'Employees');
    expect(employees.definition.fields).toMatchObject({ birth_date: { type: 'datetime' } });
    const lines = await service.generateObjectDraft('erp', 'Order_Details');
    expect(lines.definition.fields).toMatchObject({ quantity: { type: 'number' }, discount: { type: 'number' } });
  });

  it('keeps the remote key, in its field spelling, in the source comment', async () => {
    const { service } = serviceOver();
    const lines = await service.generateObjectDraft('erp', 'Order_Details');
    expect(lines.source).toContain('// Remote primary key: order_id, product_id');
  });

  it('parses as an ObjectSchema, so the save door can take it', async () => {
    const { service } = serviceOver([imported('categories', 'Categories')]);
    const draft = await service.generateObjectDraft('erp', 'Products');
    const parsed = ObjectSchema.parse(draft.definition);
    expect(parsed.external?.columnMap?.CategoryID).toBe('category_id');
    expect(parsed.fields?.category_id).toMatchObject({ type: 'lookup', reference: 'categories' });
  });
});

describe('navigations become lookups only where a column holds the key of an imported target', () => {
  it('leaves a navigation out, named, while its target is not imported', async () => {
    const { service } = serviceOver();
    const draft = await service.generateObjectDraft('erp', 'Products');

    expect(draft.definition.fields).toMatchObject({ category_id: { type: 'number' }, supplier_id: { type: 'number' } });
    expect(draft.review).toEqual([
      {
        column: 'Category',
        remoteType: 'navigation → Categories',
        note: "navigation left out of the draft: 'Categories' is not imported on datasource 'erp'; import it before this table to get the lookup",
      },
      {
        column: 'Supplier',
        remoteType: 'navigation → Suppliers',
        note: "navigation left out of the draft: 'Suppliers' is not imported on datasource 'erp'; import it before this table to get the lookup",
      },
    ]);
    // Named in the source too, where the author reviews it.
    expect(draft.source).toContain(
      "    // REVIEW: Category (navigation → Categories): navigation left out of the draft: 'Categories' is not imported",
    );
  });

  it('turns the constrained column into a lookup on the imported target', async () => {
    const { service } = serviceOver([imported('categories', 'Categories')]);
    const draft = await service.generateObjectDraft('erp', 'Products');

    expect(draft.definition.fields).toMatchObject({
      category_id: { type: 'lookup', reference: 'categories' },
      supplier_id: { type: 'number' },
    });
    expect(draft.review.map((r) => r.column)).toEqual(['Supplier']);
    expect(draft.source).toContain("    category_id: { type: 'lookup', reference: 'categories' },");
    expect(draft.source).toContain("columnMap: { 'ProductID': 'product_id',");
  });

  it('reads "imported" per datasource: the same entity set on another datasource does not count', async () => {
    const { service } = serviceOver([imported('crm_categories', 'Categories', 'crm')]);
    const draft = await service.generateObjectDraft('erp', 'Products');
    expect(draft.definition.fields).toMatchObject({ category_id: { type: 'number' } });
  });

  it('references the object itself for a navigation onto its own entity set, under an overriding name too', async () => {
    const { service, saved } = serviceOver();
    const draft = await service.generateObjectDraft('erp', 'Employees');
    expect(draft.definition.fields).toMatchObject({ reports_to: { type: 'lookup', reference: 'employees' } });
    // The collection-valued `Employees1` is never a candidate, so it is not named either.
    expect(draft.review).toEqual([]);

    await service.importObject('erp', 'Employees', { name: 'staff' });
    expect(saved[0]!.definition.fields).toMatchObject({ reports_to: { type: 'lookup', reference: 'staff' } });
  });

  it('takes a lookup onto a single-key target from a composite-key entity set', async () => {
    const { service } = serviceOver([imported('products', 'Products')]);
    const draft = await service.generateObjectDraft('erp', 'Order_Details');
    expect(draft.definition.fields).toMatchObject({
      order_id: { type: 'number' },
      product_id: { type: 'lookup', reference: 'products' },
    });
  });

  it('leaves a navigation out when its foreign-key column is not drafted', async () => {
    const { service } = serviceOver([imported('categories', 'Categories')]);
    const draft = await service.generateObjectDraft('erp', 'Products', { excludeColumns: ['CategoryID'] });
    expect(draft.review).toContainEqual({
      column: 'Category',
      remoteType: 'navigation → Categories',
      note: "navigation left out of the draft: its foreign-key property 'CategoryID' is not a column of this draft",
    });
  });

  it('carries the lookup on an import taken after the target\'s', async () => {
    const { service, saved } = serviceOver();
    await service.importObject('erp', 'Categories');
    await service.importObject('erp', 'Products');
    expect(saved.map((s) => s.name)).toEqual(['categories', 'products']);
    expect(saved[1]!.definition.fields).toMatchObject({ category_id: { type: 'lookup', reference: 'categories' } });
  });
});

describe('an imported OData object passes Gate 2 against the same $metadata', () => {
  it('validates every drafted field, the lookups included, with no diff', async () => {
    const { service } = serviceOver();
    await service.importObject('erp', 'Categories');
    await service.importObject('erp', 'Suppliers');
    await service.importObject('erp', 'Products');
    await service.importObject('erp', 'Employees');

    for (const name of ['categories', 'suppliers', 'products', 'employees']) {
      const result = await service.validateObject(name);
      expect(result, name).toEqual({ ok: true, datasource: 'erp', object: name, diffs: [] });
    }
  });

  it('NEGATIVE CONTROL — a field retyped against its EDM column is still refused', async () => {
    const { service, registry } = serviceOver();
    await service.importObject('erp', 'Products');
    const products = registry.find((o) => o.name === 'products')!;
    products.fields = { ...products.fields, discontinued: { type: 'datetime' } };
    const result = await service.validateObject('products');
    expect(result.ok).toBe(false);
    expect(result.diffs).toEqual([
      expect.objectContaining({ kind: 'type_mismatch', column: 'Discontinued', expected: 'datetime', actual: 'Edm.Boolean' }),
    ]);
  });
});

describe('the lookup the draft writes is one the driver can follow', () => {
  it('reads the product\'s category_id as the CategoryID value, and finds the category by that id', async () => {
    const { driver, requests } = driverFor({
      'Products?$select=ProductID,CategoryID': { value: [{ ProductID: 1, CategoryID: 1 }] },
      'Categories?$filter=CategoryID eq 1': { value: [{ CategoryID: 1, CategoryName: 'Beverages' }] },
    });
    const { service, registry } = serviceOver([imported('categories', 'Categories')]);
    await service.importObject('erp', 'Products');
    await service.importObject('erp', 'Categories');
    for (const o of registry) driver.registerExternalObject(o);

    const [product] = await driver.find('products', { fields: ['id', 'category_id'] });
    expect(product).toMatchObject({ id: '1', category_id: 1 });
    const [category] = await driver.find('categories', { where: { id: product!.category_id } });
    expect(category).toMatchObject({ id: '1', category_name: 'Beverages' });
    expect(requests).toContain('Categories?$filter=CategoryID eq 1');
  });
});
