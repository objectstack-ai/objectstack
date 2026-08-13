// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  assertMetadataRegisterContract,
  canonicalMetadataServiceType,
} from '../metadata-service-contract.js';

/**
 * In-memory metadata service fallback.
 *
 * Implements the IMetadataService contract with a simple Map-of-Maps store.
 * Used by ObjectKernel as an automatic fallback when no real metadata plugin
 * (e.g. MetadataPlugin with file-system persistence) is registered.
 *
 * [#7378] Carries the ruled register/read argument contract
 * (`../metadata-service-contract.ts` — the ruling is quoted there):
 * `register` refuses a `data.name` that disagrees with the `name` argument and
 * refuses a non-document `data` (rows 1/3), and every type store is keyed on
 * the CANONICAL type (row 2), so `register('objects', n, d)` and
 * `get('object', n)` address one store rather than two.
 */
export function createMemoryMetadata() {
  // canonical type -> name -> data
  const store = new Map<string, Map<string, any>>();

  // [#7378 row 2] The fold lives on the single accessor every member reads
  // and writes through, so no member can address a raw-spelling store.
  function getTypeMap(type: string): Map<string, any> {
    const canonical = canonicalMetadataServiceType(type);
    let map = store.get(canonical);
    if (!map) {
      map = new Map();
      store.set(canonical, map);
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
      // [#7378 rows 1/3] Refuse — before the store is touched — a data.name
      // that disagrees with the name argument, and a non-document data. The
      // guard's own header carries the ruling and the reasons.
      assertMetadataRegisterContract(type, name, data);
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
    // in-memory only, so registerInMemory and register share a store — but
    // NOT the [#7378] refusals: the ruling names `register`, and this member
    // is a boot-time seeding primitive for source-control-owned artefacts
    // (see assertMetadataRegisterContract's header for the boundary). It does
    // share the row-2 canonical type fold, via getTypeMap.
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
