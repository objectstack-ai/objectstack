// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  ExternalCatalogSchema,
  ExternalTableSchema,
  ExternalColumnSchema,
} from './external-catalog.zod';

describe('ExternalCatalog (ADR-0015 §4.3)', () => {
  it('parses a full catalog snapshot', () => {
    const catalog = ExternalCatalogSchema.parse({
      name: 'warehouse_catalog',
      datasource: 'warehouse',
      snapshotAt: '2026-05-30T00:00:00.000Z',
      dialect: 'postgres',
      tables: [
        {
          remoteSchema: 'mart',
          remoteName: 'fact_orders',
          columns: [
            { name: 'order_id', sqlType: 'text', nullable: false, primaryKey: true, suggestedFieldType: 'text' },
            { name: 'amount', sqlType: 'numeric(10,2)', nullable: true },
          ],
          rowCountEstimate: 12_400_000,
        },
      ],
    });
    expect(catalog.name).toBe('warehouse_catalog');
    expect(catalog.tables[0].columns[0].primaryKey).toBe(true);
    // primaryKey defaults to false when omitted.
    expect(catalog.tables[0].columns[1].primaryKey).toBe(false);
  });

  it('rejects a non-snake_case catalog name', () => {
    expect(() =>
      ExternalCatalogSchema.parse({
        name: 'Warehouse-Catalog',
        datasource: 'warehouse',
        snapshotAt: '2026-05-30T00:00:00.000Z',
        tables: [],
      }),
    ).toThrow();
  });

  it('rejects a non-datetime snapshotAt', () => {
    expect(() =>
      ExternalCatalogSchema.parse({
        name: 'warehouse_catalog',
        datasource: 'warehouse',
        snapshotAt: 'today',
        tables: [],
      }),
    ).toThrow();
  });

  it('column + table sub-schemas validate independently', () => {
    expect(() =>
      ExternalColumnSchema.parse({ name: 'x', sqlType: 'text', nullable: true }),
    ).not.toThrow();
    expect(() =>
      ExternalTableSchema.parse({ remoteName: 't', columns: [] }),
    ).not.toThrow();
  });
});
