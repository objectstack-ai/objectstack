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
