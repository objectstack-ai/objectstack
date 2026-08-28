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
// #12772 — versioned forward conversion for compiled artifacts at an
// ingestion door: replays the ADR-0087 chain (retired entries included) over
// an artifact whose declared `engines.protocol` floor predates the running
// spec, so within-line key retirements do not brick already-built artifacts.
export * from './artifact-forward-conversion.js';
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
// [#11009] The refusal both write dispatches share: a by-id call whose
// `where` carries keys the by-id path would silently discard.
export * from './engine-dispatch-unhonoured-predicate.js';
// [#11957] The READ-side sibling: `ObjectQL.findOne` REFUSES a call that selects
// no particular record (#4419), and every in-memory double answered it happily —
// which is how #11767 shipped a bootstrap bypass that was permanently inert on
// real deployments under a 641-line all-green matrix.
export * from './engine-findone-predicate.js';

// [#4513] The audit-family GOVERNANCE table (#4447) and its normalizer, sunk
// here for the same reason and by the same criterion as the two dispatch
// predicates above: the `/meta` READ path lives in
// `@objectstack/metadata-protocol`, which `@objectstack/objectql` depends on,
// so it cannot import the table from the registry that enforces it. The read
// surface and the write path now derive one answer from one table instead of
// reporting two.
export * from './audit-field-governance.js';

// [#10062] The ADR-0029 D9.6 provenance pair, sunk here from
// `@objectstack/objectql`'s registry by the same criterion as everything above:
// `@objectstack/service-automation` needs the same "does a code package ship
// this name?" answer for ADR-0048 flow precedence, and was reaching it by
// importing objectql — a package it does not declare, so the bundler inlined a
// copy of objectql's implementation into service-automation's dist. Both sides
// already declare THIS package, and it depends on neither. `objectql`
// re-exports `isCodeArtifactBody` from `registry.ts`, so its public API is
// unchanged.
export * from './code-artifact-provenance.js';

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

// [#6190 / #7018 / #8805] Which metadata WRITES carry the caller's active
// organization — sunk here from `@objectstack/runtime` by the same criterion as
// the FLS projection above, and for a defect of the same shape. The #6190
// ruling is a decision the CALLER must make (the protocol deliberately REFUSES
// an org-scoped write of a non-overridable type rather than coercing it, so the
// tenancy statement the author made is never silently rewritten) — which means
// every door that writes metadata needs the same predicate. The dispatcher owned
// the only implementation, and `@objectstack/rest` cannot import it: `runtime`
// depends on `rest`, so the reverse edge is a cycle turbo refuses — the exact
// situation this package exists to resolve. `runtime` imports it from here now,
// so its behaviour is unchanged and there is no second copy to drift.
export * from './meta-write-org-scope.js';

// [#12702] The capability half of the same decision: which CALLERS a `/meta`
// item write door admits — `manage_metadata` as before, plus the org-scoped
// `manage_org_presentation` for org-overridable types written to the caller's
// own active organization. Sunk here by the same criterion as the scope half
// above: the doors live in `@objectstack/runtime` and `@objectstack/rest`,
// which share no other common home, and the predicate is registry-coupled
// (through `declaresOrgOverride`) so a second copy is forbidden drift.
export * from './meta-write-capability.js';

// [#8707 / #10101] The shared platform-row organization resolver — sunk here
// from `@objectstack/plugin-audit` per the maintainer ruling recorded on
// cloud#1395 ("promoted to a shared resolver used by all three platform-row
// writers"). The three sanctioned consumers — audit stamping, the approval-row
// writer, the automation-run recorder — live in `plugin-audit`,
// `plugin-approvals` and `service-automation`, which share no other common
// home; this package's `{ @objectstack/spec, zod }`-only contract lets all
// three import ONE precedence instead of drifting a copy each. `plugin-audit`
// re-exports `createFieldPresenceProbe` from its original path, so its public
// surface is unchanged.
export * from './record-organization.js';
