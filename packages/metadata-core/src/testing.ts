// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test-only entry point. Importing this module pulls in `vitest`, so
 * downstream consumers must list `vitest` as a devDependency.
 */

export * from './contract-suite.js';
// [ADR-0106 / #3682] The metadata-plane FLS case table, driven from the
// `@objectstack/rest` and `@objectstack/runtime` suites so a schema-serving
// exit that forgets the projection fails by name. Test-only: it belongs beside
// the contract suite, not on the runtime entry.
export * from './object-schema-fls-contract.js';
// [#29025] The shared corpus both faces of the flow-cycle judge are driven
// from — the engine's registration (`@objectstack/service-automation`) and the
// runtime authoring gate (`@objectstack/metadata-protocol`) — so the two
// refuse exactly the same graphs. Test-only, beside the FLS case table.
export * from './flow-cycle-corpus.js';
