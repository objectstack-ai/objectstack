// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The host of each facet of `SqlDriver`, built ONCE per driver (#30105):
 * what every stub of a facet hands that facet's bodies as `this`, in place of
 * a host literal built on every call. Each `FacetHost` below is filled by the
 * factory `SqlDriver`'s static block installs, the one place that can read
 * the class's private members; the host is built on the first call that needs
 * it and kept for the driver's life. A method goes as a closure that calls it
 * on the driver at call time, a field or accessor as a getter (and a setter
 * when a body assigns it), so a body reads and writes the driver exactly as
 * the per-call literal let it.
 *
 * Written by `scripts/codemod-split-sql-driver.mjs`; it imports types only, so it forms no
 * evaluation cycle and is evaluated before the class whichever module loads
 * first. `index.ts` re-exports nothing from this module.
 */

import type { SqlDriver } from './sql-driver.js';
import type { AggregationHost } from './sql-driver-aggregation.js';
import type { BulkOperationsHost } from './sql-driver-bulk-operations.js';
import type { ClassHeadHost } from './sql-driver-class-head.js';
import type { ColumnCreationHost } from './sql-driver-column-creation.js';
import type { CrudHost } from './sql-driver-crud.js';
import type { DatabaseHelpersHost } from './sql-driver-database-helpers.js';
import type { DeferredDdlHost } from './sql-driver-deferred-ddl.js';
import type { DistinctHost } from './sql-driver-distinct.js';
import type { FieldMappingHost } from './sql-driver-field-mapping.js';
import type { FilterHelpersHost } from './sql-driver-filter-helpers.js';
import type { InternalHelpersHost } from './sql-driver-internal-helpers.js';
import type { LifecycleHost } from './sql-driver-lifecycle.js';
import type { ManagedDriftHost } from './sql-driver-managed-drift.js';
import type { QueryPlanHost } from './sql-driver-query-plan.js';
import type { RotationHost } from './sql-driver-rotation.js';
import type { SchemaSyncSectionHost } from './sql-driver-schema-sync-section.js';
import type { SequenceSemanticsHost } from './sql-driver-sequence-semantics.js';
import type { SqliteSerialisationHost } from './sql-driver-sqlite-serialisation.js';
import type { TransactionsSectionHost } from './sql-driver-transactions-section.js';
import type { WindowFunctionBuilderHost } from './sql-driver-window-function-builder.js';
import type { WindowFunctionsHost } from './sql-driver-window-functions.js';

/** One facet's host for each driver: built on first use, kept for the driver's life. */
export class FacetHost<H> {
  private readonly hosts = new WeakMap<SqlDriver, H>();
  private build: ((driver: SqlDriver) => H) | undefined;

  constructor(private readonly facet: string) {}

  /** Called once, from `SqlDriver`'s static block. */
  install(build: (driver: SqlDriver) => H): void {
    this.build = build;
  }

  /** The host of `driver`, built on first use. */
  of(driver: SqlDriver): H {
    let host = this.hosts.get(driver);
    if (host === undefined) {
      if (this.build === undefined) {
        throw new Error(`${this.facet}: SqlDriver has not installed its host factory`);
      }
      host = this.build(driver);
      this.hosts.set(driver, host);
    }
    return host;
  }
}

export const aggregationHost = new FacetHost<AggregationHost>('AggregationFacet');
export const bulkOperationsHost = new FacetHost<BulkOperationsHost>('BulkOperationsFacet');
export const classHeadHost = new FacetHost<ClassHeadHost>('ClassHeadFacet');
export const columnCreationHost = new FacetHost<ColumnCreationHost>('ColumnCreationFacet');
export const crudHost = new FacetHost<CrudHost>('CrudFacet');
export const databaseHelpersHost = new FacetHost<DatabaseHelpersHost>('DatabaseHelpersFacet');
export const deferredDdlHost = new FacetHost<DeferredDdlHost>('DeferredDdlFacet');
export const distinctHost = new FacetHost<DistinctHost>('DistinctFacet');
export const fieldMappingHost = new FacetHost<FieldMappingHost>('FieldMappingFacet');
export const filterHelpersHost = new FacetHost<FilterHelpersHost>('FilterHelpersFacet');
export const internalHelpersHost = new FacetHost<InternalHelpersHost>('InternalHelpersFacet');
export const lifecycleHost = new FacetHost<LifecycleHost>('LifecycleFacet');
export const managedDriftHost = new FacetHost<ManagedDriftHost>('ManagedDriftFacet');
export const queryPlanHost = new FacetHost<QueryPlanHost>('QueryPlanFacet');
export const rotationHost = new FacetHost<RotationHost>('RotationFacet');
export const schemaSyncSectionHost = new FacetHost<SchemaSyncSectionHost>('SchemaSyncSectionFacet');
export const sequenceSemanticsHost = new FacetHost<SequenceSemanticsHost>('SequenceSemanticsFacet');
export const sqliteSerialisationHost = new FacetHost<SqliteSerialisationHost>('SqliteSerialisationFacet');
export const transactionsSectionHost = new FacetHost<TransactionsSectionHost>('TransactionsSectionFacet');
export const windowFunctionBuilderHost = new FacetHost<WindowFunctionBuilderHost>('WindowFunctionBuilderFacet');
export const windowFunctionsHost = new FacetHost<WindowFunctionsHost>('WindowFunctionsFacet');
