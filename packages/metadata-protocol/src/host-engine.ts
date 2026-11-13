// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IObjectQLEngine } from '@objectstack/core';
import type { StoredExpressionFillCapture } from './protocol-stored-expression-fill.js';
import type { PublishedColumnChanges } from './protocol-registry-hydration.js';

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
  /**
   * [#32590] The publish's column half (`@objectstack/objectql`'s
   * `applyPublishedColumnChanges`): after {@link syncObjectSchema}, bring an
   * existing table's columns to the published declaration where that cannot
   * lose data, and answer what was applied and what was not. Declared
   * explicitly for the reason `transaction` is; optional because a host may be
   * a test double or a metadata-only store, and degrading means the sync stays
   * the additive one it always was.
   */
  applyPublishedColumnChanges?(objectName: string): Promise<PublishedColumnChanges | undefined>;
  /** DDL: drop the physical table for an object schema. */
  dropObjectSchema(...args: any[]): Promise<any>;
  /**
   * ObjectQL's ambient transaction (ADR-0034), typed off the `objectql` slot
   * contract (ADR-0119 D1) so this narrow host surface cannot drift from the
   * real signature. Declared explicitly because an explicit member beats the
   * index signature below — structurally `[key: string]: any` would type it
   * `any` and hide exactly the mistakes this contract exists to catch.
   *
   * Optional HERE, unlike on `IObjectQLEngine` where it is required: a host may
   * be a test double or a metadata-only store. Callers keep their runtime
   * probes and must say what degrading means at their seam — a caller that
   * cannot lose atomicity silently fails closed (see `batchData`, ADR-0119 D4).
   */
  transaction?: IObjectQLEngine['transaction'];
  /**
   * The engine's `internal: true` evaluate refusal (`QueryEvaluationGate` on the
   * `objectql` slot contract), which the data door asks before the engine reads
   * anything (`assertNoInternalFieldEvaluated` on the protocol). Typed off the
   * slot contract for the reason `transaction` is; optional HERE for the same
   * reason too. Degrading means judging no field at the door: the flag is the
   * engine's to honour, and an engine without the gate does not withhold the
   * column from its rows either. The door's relation-target exposure question
   * does not degrade: it is asked at every hop either way.
   */
  assertNoInternalFieldEvaluated?: IObjectQLEngine['assertNoInternalFieldEvaluated'];
  /**
   * [#32527] The engine's capture of an object's stored computed fields
   * before a door makes a change to it live, and the fill that change owes
   * (`@objectstack/objectql`'s `captureStoredExpressions`). Declared
   * explicitly for the reason `transaction` is; optional because a host may
   * be a test double or a metadata-only store, and degrading means no fill:
   * see `protocol-stored-expression-fill.ts`.
   */
  captureStoredExpressions?(object: string): StoredExpressionFillCapture;
  // Protocol accesses additional engine members structurally; keep it permissive
  // for this relocation (behavior unchanged — the concrete engine is injected).
  [key: string]: any;
}
