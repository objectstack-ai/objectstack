// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/core
 * 
 * Core runtime for ObjectStack microkernel architecture.
 * Provides plugin system, dependency injection, and lifecycle management.
 */

export * from './kernel-base.js';
export * from './kernel.js';
export * from './plugin-order.js';
export * from './lite-kernel.js';
export * from './types.js';
export * from './logger.js';
export * from './plugin-loader.js';
// `./api-registry.js` + `./api-registry-plugin.js` were RETIRED in #4939
// (ADR-0049 enforce-or-remove). `createApiRegistryPlugin()` registered an
// `api-registry` service that only `packages/core/examples/` ever composed —
// no runtime, CLI or example app mounted it, and a real 47-plugin boot had no
// such service — so the ~500-line `ApiRegistry` and the whole
// `ApiEndpointRegistration` schema family it served were zero-execution.
// Declarative endpoints have ONE shape now: `ApiEndpointSchema`
// (`@objectstack/spec/api`), whose executor is tracked by #5040.
export * as QA from './qa/index.js';

// Export security utilities
export * from './security/index.js';

// Export environment utilities
export * from './utils/env.js';

// Export timezone-aware calendar utilities (ADR-0053 Phase 2)
export * from './utils/datetime.js';

// Export the shared batched-write helper (framework#2678)
export * from './utils/bulk-write.js';

// Export the shared write-response `internal: true` strip (#7823, #8497) — the
// ONE helper every write mouth that answers an external caller runs its
// records through. It lives here, on the floor all three transports share,
// because the mouths are not all on the protocol class: `rest` and `mcp` both
// reach the engine directly and neither depends on `@objectstack/metadata-
// protocol` (which re-exports these two names unchanged).
export * from './utils/internal-write-response.js';

// Export the migration-journal runner (ADR-0119 D2, #4617) — chunk-atomic
// migrations with durable recovery, plus the shared `engineCanRollBack` gate
// that `@objectstack/metadata-protocol`'s atomic `batchData` also uses.
export * from './utils/migration-journal.js';

// Export the runtime filter-placeholder resolver (framework#3582)
export * from './utils/filter-tokens.js';

// [#8690] Can a temporal column's storage rule read this comparand? The VALUE
// half of the field-typed judgement behind the engine's temporal-comparand door
// and the analytics raw-SQL decline — one rule, two packages that do not depend
// on each other.
export * from './utils/temporal-comparand.js';

// Export the shared single-record 404 (#4435/#5138, moved down here in #7867) —
// the one `RECORD_NOT_FOUND` envelope `protocol.updateData`/`deleteData`,
// `callData`'s ObjectQL fallback and the engine's own by-id write gate answer
// with. `@objectstack/metadata-protocol` re-exports it from its original home.
export * from './utils/record-not-found.js';

// Export in-memory fallbacks for core-criticality services
export * from './fallbacks/index.js';

// [#7378] The IMetadataService register/read argument contract (three-cell
// maintainer ruling, 2026-08-12) — shared by every shipped implementation so
// the refusals and the canonical type fold have one home instead of three.
export * from './metadata-service-contract.js';

// Export Phase 2 components - Advanced lifecycle management
export * from './health-monitor.js';
export * from './hot-reload.js';
export * from './dependency-resolver.js';

// Export Phase 3 components - Package lifecycle management
export * from './namespace-resolver.js';

// Re-export contracts from @objectstack/spec for backward compatibility
export type { 
    Logger,
    IHttpServer,
    IHttpRequest,
    IHttpResponse,
    RouteHandler,
    Middleware,
    HttpResponseObservation,
    HttpResponseObserver,
    IDataEngine,
    IObjectQLEngine,
    EngineSchemaRegistryView,
    EngineTransactionOptions,
    EngineTransactionInfo,
    IDataDriver,
} from '@objectstack/spec/contracts';
// The reserved route label for unrouted requests on the `afterResponse`
// observation seam (#9835) — a VALUE, so it rides beside the type block above.
export { UNMATCHED_ROUTE_PATTERN } from '@objectstack/spec/contracts';
