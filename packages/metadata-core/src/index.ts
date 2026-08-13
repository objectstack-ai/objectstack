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

// [#4513] The audit-family GOVERNANCE table (#4447) and its normalizer, sunk
// here for the same reason and by the same criterion as the two dispatch
// predicates above: the `/meta` READ path lives in
// `@objectstack/metadata-protocol`, which `@objectstack/objectql` depends on,
// so it cannot import the table from the registry that enforces it. The read
// surface and the write path now derive one answer from one table instead of
// reporting two.
export * from './audit-field-governance.js';

// [#6562] The served-document injection/strip pair over the injected-system-
// column definition tables, sunk here by the same criterion and for the same
// cycle as the governance table above. The DEFINITION tables themselves and the
// #7865 provenance derivation moved one package further down — into
// `@objectstack/spec/data` (#8116) — so the author-time surface
// (`@objectstack/lint`, spec-only by contract) can read them too; this module
// re-exports every moved name, so this package's public surface is unchanged.
// `@objectstack/objectql` reads the tables (via this re-export) instead of its
// own literals.
export * from './injected-system-columns.js';

// [ADR-0106 / #3682] The metadata-plane FLS projection — one masking function
// and one fingerprint, shared by every object-schema exit in
// `@objectstack/rest` and `@objectstack/runtime`. Sunk here by the same
// criterion as the governance table above: the exits live in two dispatch
// packages that share no other common home, and D5 ("every schema-serving
// outlet, or the mask is decoration") is only true if they all run the same
// projection rather than a copy each.
export * from './object-schema-fls.js';

// [#7730 / #7774] The i18n-bundle DISCRIMINATOR table — which metadata types
// are identified by `(name, <field>)` rather than by `name` alone — sunk here
// by the same criterion as the governance table above. `@objectstack/objectql`
// (the SchemaRegistry, #7730) and `@objectstack/metadata-protocol` (the
// unscoped `/meta` list merge, #7774) both key metadata by name, objectql
// depends on metadata-protocol, and a bundle that survives one layer's key but
// not the other's is still collapsed. `objectql` re-exports
// `ITEM_KEY_DISCRIMINATORS` from `registry.ts`, so its surface is unchanged.
export * from './item-key-discriminators.js';
