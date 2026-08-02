// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IObjectQLEngine } from '@objectstack/core';

/**
 * The engine surface the metadata protocol needs from its host (ADR-0076).
 *
 * The protocol uses the data engine purely as storage + a schema registry; it
 * is injected a concrete engine at runtime (today `@objectstack/objectql`'s
 * `ObjectQL`). Typing against this interface — instead of the concrete class —
 * is what lets `@objectstack/metadata-protocol` avoid a dependency on
 * `@objectstack/objectql` (which would otherwise form a cycle, since the
 * ObjectQL plugin constructs the protocol).
 */
export interface MetadataHostEngine extends IDataEngine {
  /** Schema registry (listItems/getItem/registerItem/getObject/registerObject/installPackage/...). */
  registry: any;
  /** DDL: create/sync the physical table for an object schema. */
  syncObjectSchema(...args: any[]): Promise<any>;
  /** DDL: drop the physical table for an object schema. */
  dropObjectSchema(...args: any[]): Promise<any>;
  /**
   * ObjectQL's ambient transaction (ADR-0034), typed off the `objectql` slot
   * contract (ADR-0118 D1) so this narrow host surface cannot drift from the
   * real signature. Declared explicitly because an explicit member beats the
   * index signature below — structurally `[key: string]: any` would type it
   * `any` and hide exactly the mistakes this contract exists to catch.
   *
   * Optional HERE, unlike on `IObjectQLEngine` where it is required: a host may
   * be a test double or a metadata-only store. Callers keep their runtime
   * probes and must say what degrading means at their seam — a caller that
   * cannot lose atomicity silently fails closed (see `batchData`, ADR-0118 D4).
   */
  transaction?: IObjectQLEngine['transaction'];
  // Protocol accesses additional engine members structurally; keep it permissive
  // for this relocation (behavior unchanged — the concrete engine is injected).
  [key: string]: any;
}
