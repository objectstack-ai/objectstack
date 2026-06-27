// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { 
  EngineQueryOptions,
  DataEngineInsertOptions, 
  EngineUpdateOptions, 
  EngineDeleteOptions,
  EngineAggregateOptions, 
  EngineCountOptions,
  DataEngineRequest,
} from '@objectstack/spec/data';

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
  insert(objectName: string, data: any | any[], options?: DataEngineInsertOptions): Promise<any>;
  update(objectName: string, data: any, options?: EngineUpdateOptions): Promise<any>;
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


