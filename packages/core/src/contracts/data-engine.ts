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
} from '@objectstack/spec/data';

/**
 * In-process write-observability hooks for `insert`/`update` (#3407).
 * Mirror of `WriteObservabilityOptions` in `@objectstack/spec/contracts` —
 * see that definition for the full rationale (in-process only; never part of
 * the serializable options schemas or the RPC boundary).
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
