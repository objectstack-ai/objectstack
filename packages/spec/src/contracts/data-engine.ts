// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  EngineQueryOptions,
  DataEngineInsertOptions,
  EngineUpdateOptions,
  EngineDeleteOptions,
  EngineAggregateOptions,
  EngineCountOptions,
  DataEngineRequest,
  DroppedFieldsEvent,
} from '../data/index.js';

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
  find(objectName: string, query?: EngineQueryOptions): Promise<any[]>;
  findOne(objectName: string, query?: EngineQueryOptions): Promise<any>;
  insert(objectName: string, data: any | any[], options?: DataEngineInsertOptions & WriteObservabilityOptions): Promise<any>;
  update(objectName: string, data: any, options?: EngineUpdateOptions & WriteObservabilityOptions): Promise<any>;
  delete(objectName: string, options?: EngineDeleteOptions): Promise<any>;
  count(objectName: string, query?: EngineCountOptions): Promise<number>;
  aggregate(objectName: string, query: EngineAggregateOptions): Promise<any[]>;

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
}
