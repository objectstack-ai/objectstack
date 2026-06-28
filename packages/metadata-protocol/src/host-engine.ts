// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/core';

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
  // Protocol accesses additional engine members structurally; keep it permissive
  // for this relocation (behavior unchanged — the concrete engine is injected).
  [key: string]: any;
}
