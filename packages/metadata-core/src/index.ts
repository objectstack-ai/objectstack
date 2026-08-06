// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata-core` — Repository contracts and reference
 * `InMemoryRepository` implementation. See ADR-0008 for the
 * architectural overview.
 */

export * from './types.js';
export * from './errors.js';
export * from './canonicalize.js';
export * from './repository.js';
export * from './in-memory-repository.js';
export * from './cache.js';
export * from './layered-repository.js';
export * from './protocol-handshake.js';
export * from './objects/index.js';

// [#5619] The ObjectQL WRITE-VERB dispatch predicates (#4550 delete / #5480
// update), sunk here from `@objectstack/objectql` so that a package objectql
// itself depends on — `@objectstack/metadata-protocol` — can bind its fake
// engines to the producer's own decision instead of a hand-written copy of it.
// The reverse import would have closed a turbo-rejected cycle; this package is
// the one both sides already depend on, and it depends on neither. `objectql`
// re-exports all of it from the original paths, so its public API is unchanged.
// See `scripts/check-engine-double-contract.mjs` — the gate over the doubles.
export * from './engine-delete-dispatch.js';
export * from './engine-update-dispatch.js';
