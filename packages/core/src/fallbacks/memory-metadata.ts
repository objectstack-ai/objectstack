// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-memory metadata service fallback.
 *
 * Implements the IMetadataService contract with a simple Map-of-Maps store.
 * Used by ObjectKernel as an automatic fallback when no real metadata plugin
 * (e.g. MetadataPlugin with file-system persistence) is registered.
 */
export function createMemoryMetadata() {
  // type -> name -> data
  const store = new Map<string, Map<string, any>>();

  function getTypeMap(type: string): Map<string, any> {
    let map = store.get(type);
    if (!map) {
      map = new Map();
      store.set(type, map);
    }
    return map;
  }

  return {
    // [#4058] `degraded` (ADR-0076 D12): the registry is real — everything
    // registered is listable and readable back — it simply never reaches disk
    // or a database. `handlerReady` keeps the `degraded` default (true): the
    // dispatcher's `/meta` domain serves this implementation.
    __serviceInfo: {
      status: 'degraded' as const,
      message: 'In-memory metadata registry — real reads and writes, no persistence (lost on restart). Register MetadataPlugin for a persisted registry.',
    },
    _serviceName: 'metadata',
    async register(type: string, name: string, data: any): Promise<void> {
      getTypeMap(type).set(name, data);
    },
    // Mirror MetadataManager.registerInMemory (synchronous, no persistence).
    // AppPlugin gates code-defined-datasource / stack-RBAC registration on
    // `typeof metadata.registerInMemory === 'function'` (it must register
    // GitOps-managed artefacts *listably* but never persist them). Without this
    // method the guard was false on the host-config / standalone boot path —
    // where this fallback (not MetadataPlugin) provides the `metadata` service —
    // so `defineStack({ datasources })` entries silently never reached the
    // registry and were absent from GET /api/v1/datasources and
    // GET /api/v1/meta/datasource (ADR-0015 §18). This store is already
    // in-memory only, so registerInMemory and register share an implementation.
    registerInMemory(type: string, name: string, data: any): void {
      getTypeMap(type).set(name, data);
    },
    async get(type: string, name: string): Promise<any> {
      return getTypeMap(type).get(name);
    },
    async list(type: string): Promise<any[]> {
      return Array.from(getTypeMap(type).values());
    },
    async unregister(type: string, name: string): Promise<void> {
      getTypeMap(type).delete(name);
    },
    async exists(type: string, name: string): Promise<boolean> {
      return getTypeMap(type).has(name);
    },
    async listNames(type: string): Promise<string[]> {
      return Array.from(getTypeMap(type).keys());
    },
    async getObject(name: string): Promise<any> {
      return getTypeMap('object').get(name);
    },
    async listObjects(): Promise<any[]> {
      return Array.from(getTypeMap('object').values());
    },
  };
}
