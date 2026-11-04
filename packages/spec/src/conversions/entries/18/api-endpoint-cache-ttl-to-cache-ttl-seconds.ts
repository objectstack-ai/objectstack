// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `api-endpoint-cache-ttl-to-cache-ttl-seconds` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `apiEndpointCacheTtlToCacheTtlSeconds` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';

/**
 * `apis[].cacheTtl` → `apis[].cacheTtlSeconds` (protocol 18, #15677 for #14478)
 * — the `api` half of the same rename `hookTimeoutToTimeoutMs` and
 * `jobTimeoutToTimeoutMs` document, and the ONE key of that card's twelve that
 * also gets a conversion: `apis:` is a stack collection
 * (`apis: z.array(ApiEndpointSchema)`) and `api` is a registered metadata kind
 * stored as a row, so the chain has a seam that sees it. The other eleven are
 * wire payloads and construction arguments the chain never touches, so their
 * D3 entries are their only channel. This key's family carries a D3 entry too,
 * `api-endpoint-cache-ttl-unit-in-key`: the rename keeps the value, and only
 * the author can say whether the value was ever in seconds.
 *
 * Same posture as its two siblings: retired from the load path, tombstoned at
 * the schema, replayable here. The fixture keeps `rateLimit` out of the
 * converted endpoint on purpose — it is the one neighbouring policy key whose
 * own shape is still in a live window — and carries a second endpoint that
 * never authored `cacheTtl` so copy-on-write identity is pinned too.
 */
const apiEndpointCacheTtlToCacheTtlSeconds: MetadataConversion = {
  id: 'api-endpoint-cache-ttl-to-cache-ttl-seconds',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.3.0',
  surface: 'apis[].cacheTtl',
  summary: "api endpoint key 'cacheTtl' \u2192 'cacheTtlSeconds' (a duration key carries its unit in its name, and this one's unit lived only in the description; the value, seconds, is unchanged, and the key stays GET-only)",
  apply(stack, emit) {
    return mapCollection(stack, 'apis', (endpoint, path) => {
      const renamed = renameKey(endpoint, 'cacheTtl', 'cacheTtlSeconds');
      if (!renamed) return endpoint;
      emit({ from: 'cacheTtl', to: 'cacheTtlSeconds', path: `${path}.cacheTtlSeconds` });
      return renamed;
    });
  },
  fixture: {
    before: {
      apis: [
        {
          name: 'list_tasks',
          path: '/api/v1/apps/showcase/tasks',
          method: 'GET',
          type: 'object_operation',
          objectParams: { object: 'task', operation: 'find' },
          cacheTtl: 30,
        },
        // An endpoint that never authored the key keeps its identity (copy-on-write).
        { name: 'create_task', path: '/api/v1/apps/showcase/tasks', method: 'POST', type: 'object_operation' },
      ],
    },
    after: {
      apis: [
        {
          name: 'list_tasks',
          path: '/api/v1/apps/showcase/tasks',
          method: 'GET',
          type: 'object_operation',
          objectParams: { object: 'task', operation: 'find' },
          cacheTtlSeconds: 30,
        },
        { name: 'create_task', path: '/api/v1/apps/showcase/tasks', method: 'POST', type: 'object_operation' },
      ],
    },
    expectedNotices: 1,
  },
};

export { apiEndpointCacheTtlToCacheTtlSeconds };
