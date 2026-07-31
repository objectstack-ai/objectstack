// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  BaseEngineOptions,
  EngineQueryOptions,
  DataEngineInsertOptions,
  EngineUpdateOptions,
  EngineDeleteOptions,
  EngineAggregateOptions,
  EngineCountOptions,
  DataEngineRequest,
  DroppedFieldsEvent,
} from '../data/index.js';
import type { IDataDriver } from './data-driver.js';

/**
 * In-process write-observability hooks for `insert`/`update` (#3407).
 *
 * `onFieldsDropped` is invoked by the engine when caller-supplied write fields
 * are LEGALLY stripped from the payload before the driver write — static
 * `readonly` (#2948) or a TRUE `readonlyWhen` predicate (#3042). The write
 * still succeeds; the listener exists so callers that report per-field success
 * (e.g. a flow's `update_record` step) can surface a warning instead of a
 * silent success (#3356's masked stage write-backs).
 *
 * Lives on the TS contract — NOT in the serializable Zod options schemas
 * (`EngineUpdateOptionsSchema` etc.): a function is unrepresentable in JSON
 * Schema and cannot cross the RPC (Virtual Data Engine) boundary, so remote
 * callers simply never receive these events. The event payload itself is
 * Zod-first: `DroppedFieldsEventSchema` in `data/data-engine.zod.ts`.
 *
 * A listener that throws must never break the write — engines catch and log.
 */
export interface WriteObservabilityOptions {
  /** Called once per strip pass that dropped ≥1 caller-supplied field. */
  onFieldsDropped?: (event: DroppedFieldsEvent) => void;
}

/**
 * IDataEngine - Standard Data Engine Interface
 *
 * Abstract interface for data persistence capabilities.
 * Following the Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete database implementations.
 *
 * All query methods use standard QueryAST parameter names
 * (where/fields/orderBy/limit/offset/expand) to eliminate mechanical translation
 * between the Engine and Driver layers.
 *
 * Aligned with 'src/data/data-engine.zod.ts' in @objectstack/spec.
 */

export interface IDataEngine {
  /**
   * Read methods take the execution context in a TRAILING options argument,
   * the same position the write methods take theirs.
   *
   * [#4251] Declared because the implementation and its callers were already
   * there: ObjectQL's `find`/`findOne`/`count`/`aggregate` have taken this
   * argument since the read/write split was unified, and its own doc explains
   * why — the same `{ context }` object was correct as the 3rd arg to `insert`
   * but SILENTLY DROPPED as the 3rd arg to `find`, so an intended `isSystem`
   * bypass just vanished (control-plane reads coming back empty once
   * org-scoping hooks landed). The contract kept only `query.context`, so
   * every caller passing the trailing one — the current-user endpoints'
   * permission-set loader among them — had to reach it through `any`, which is
   * exactly the erasure this issue is sweeping. `query.context` remains
   * supported; when both are given, `options.context` wins.
   */
  find(objectName: string, query?: EngineQueryOptions, options?: BaseEngineOptions): Promise<any[]>;
  findOne(objectName: string, query?: EngineQueryOptions, options?: BaseEngineOptions): Promise<any>;
  insert(objectName: string, data: any | any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<any>;
  update(objectName: string, data: any, options?: EngineUpdateOptions & WriteObservabilityOptions): Promise<any>;
  delete(objectName: string, options?: EngineDeleteOptions): Promise<any>;
  count(objectName: string, query?: EngineCountOptions, options?: BaseEngineOptions): Promise<number>;
  aggregate(objectName: string, query: EngineAggregateOptions, options?: BaseEngineOptions): Promise<any[]>;

  /**
   * Vector Search (AI/RAG)
   */
  vectorFind?(objectName: string, vector: number[], options?: { where?: any, limit?: number, fields?: string[], threshold?: number }): Promise<any[]>;

  /**
   * Batch Operations (Transactional)
   */
  batch?(requests: DataEngineRequest[], options?: { transaction?: boolean }): Promise<any[]>;

  /**
   * Execute raw command (Escape hatch)
   */
  execute?(command: any, options?: Record<string, any>): Promise<any>;

  /**
   * Driver registry — optional: only engines that own a named-driver registry.
   *
   * [#4251] Declared because the binding is evidenced, not to fill the table:
   * ObjectQL implements both (`packages/objectql/src/engine.ts`, the `drivers`
   * map), and DefaultDatasourcePlugin reads them to re-register the default
   * driver as a `driver.<name>` kernel service — the surface `os migrate`
   * (SQL_DRIVER_SERVICES) and serve's storage detection locate drivers
   * through. Optional because `IDataEngine` is also satisfied by engines with
   * no such registry (test fakes, remote/virtual engines); callers probe with
   * `?.`, which is what the runtime caller already did while typed `any`.
   */
  getDefaultDriverName?(): string | undefined;
  getDriverByName?(name: string): IDataDriver | undefined;
}
