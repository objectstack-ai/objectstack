// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ExternalCatalog — cached remote-schema snapshot for a federated datasource
 * (ADR-0015 §4.3).
 *
 * Introspecting a mature warehouse on every boot is expensive, so the
 * `IExternalDatasourceService.refreshCatalog` persists a snapshot of the
 * remote tables/columns as an `external_catalog` metadata record. The
 * boot-validation gate (Gate 2) and Studio's schema browser read from it;
 * drift is detected by diffing a fresh introspection against the snapshot.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/** A single remote column captured in a catalog snapshot. */
export const ExternalColumnSchema = z.object({
  name: z.string().describe('Remote column name'),
  sqlType: z.string().describe('Raw remote SQL type (e.g. "numeric(10,2)")'),
  nullable: z.boolean().describe('Whether the remote column is nullable'),
  primaryKey: z.boolean().default(false).describe('Part of the remote primary key'),
  suggestedFieldType: z.string().optional()
    .describe('ObjectStack field type suggested by the type-compat matrix'),
});

export type ExternalColumn = z.infer<typeof ExternalColumnSchema>;

/** A single remote table/view captured in a catalog snapshot. */
export const ExternalTableSchema = z.object({
  remoteSchema: z.string().optional().describe('Remote schema/database qualifier'),
  remoteName: z.string().describe('Remote table/view name'),
  columns: z.array(ExternalColumnSchema).describe('Remote columns'),
  indexes: z.array(z.object({
    name: z.string(),
    columns: z.array(z.string()),
    unique: z.boolean(),
  })).optional().describe('Remote indexes, when introspectable'),
  rowCountEstimate: z.number().optional().describe('Approximate row count'),
});

export type ExternalTable = z.infer<typeof ExternalTableSchema>;

/**
 * The persisted snapshot of a federated datasource's remote schema.
 * Conventionally named `<datasource>_catalog`.
 */
export const ExternalCatalogSchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/)
    .describe('Catalog id, conventionally `<datasource>_catalog`.'),
  datasource: z.string().describe('Datasource.name this catalog snapshots.'),
  snapshotAt: z.string().datetime().describe('When the snapshot was taken (ISO 8601).'),
  dialect: z.string().optional().describe('Remote SQL dialect, when known.'),
  tables: z.array(ExternalTableSchema).describe('Snapshotted remote tables.'),
}));

export type ExternalCatalog = z.infer<typeof ExternalCatalogSchema>;
