// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export * from './query.zod';
export * from './filter.zod';
// The comparand-type door (#7872) — the accepted literal comparand set
// (`string | number | bigint | boolean | null | Date`, the measured superset
// of #7956's divergence matrix), the walk `parseFilterAST` and the engine's
// lowering seam enforce it with, and the sentence the SQL family's refusals
// quote instead of hand-copying. Everything outside the set is refused with
// the `INVALID_FILTER` / 400 envelope at the compile face, so the frozen
// drivers (#5499) inherit one answer instead of crashing (memory × BigInt) or
// letting the BSON encoder edit the query (mongo × undefined → match-all).
export * from './filter-comparand-type';
// Canonical conformance cases for the filter logical combinators — the shared
// standard the five independent FilterCondition backends are each checked
// against, so they cannot drift apart again (#3774; the fifth — MongoDB's
// `translateFilter` — was enrolled by #4405).
export * from './filter-logic-conformance';
// The boolean identity reduction those cases pin (#5659) — `$and: []` is TRUE,
// `$or: []` is FALSE, `{}` is a TRUE disjunct, `$not: {}` is FALSE. One
// implementation, consumed by driver-sql, driver-mongodb, driver-memory and the
// flow linter, so the scan and the compilers cannot answer with two different
// predicates. Deliberately a sibling of the case table rather than a member of
// it: the table is data every backend is checked against, this is the shared
// answer three of them now compute WITH.
export * from './filter-verdict';
// [#8220, A of #7929] Filter-subtree provenance — the mark the two read-scope
// merge boundaries stamp on each side of `{ $and: [authorWhere, scope] }`, so
// the SQL family's cross-field refusal can restore the author's full
// diagnostic without re-disclosing policy. Fail direction is CLOSED by
// declaration: unmarked or ambiguous withholds, exactly like `'policy'`.
export * from './filter-subtree-provenance';
// [#8371] The FILTER axis' dotted-path verdict — ONE head-type classification
// consumed by both doors (metadata-protocol's ingress gate and objectql's
// engine seam), so the two cannot drift into answering one spelling two ways.
// Relation / virtual / scalar heads are refused; structured-JSON heads are
// DELIBERATELY unjudged (the ruled carve-out — live on two of three backends).
export * from './filter-dotted-head';
// Canonical conformance cases for the filter TEXT operators — case folding
// (ASCII-only, #4706 Q1), literal comparands (no LIKE wildcards, no regex
// metacharacters), and the refusal of the retired `$regex`/`$options`. A
// sibling of the logic table rather than rows inside it: those two axes are
// explicitly out of that table's scope, and this one needs an `expectRejection`
// discriminant it deliberately never grew (#5701).
export * from './filter-text-conformance';
// Canonical conformance cases for the comparand-type door (#7872) — each of
// the six accepted types compiles on every driver path, and each refused type
// gets the loud INVALID_FILTER refusal at the door, the two worst measured
// cells (mongo × undefined silent-edit, memory × BigInt crash) included. A
// sibling of the text table for the same reason that table is a sibling of the
// logic table: comparand TYPE is its own axis, out of both of their scopes.
export * from './filter-comparand-type-conformance';
export * from './temporal-conformance';
// Canonical conformance cases for deterministic paged reads — the standard
// every driver's `find()` is held to whenever `limit`/`offset` slice the result
// set, so neither a sort key that fails to identify a row (#3106) nor the
// absence of one altogether (#4363) can let pages overlap or skip.
export * from './pagination-conformance';
// Canonical conformance cases for the AGGREGATE vocabulary — the values each
// declared `AggregationFunction` must produce over one fixture. Created with
// `count_distinct`'s SQL lowering (#6409), whose emitted shape
// (`count(distinct x)`) is the first in the vocabulary that two faces of one
// driver can get wrong in ways only a row-result comparison sees.
export * from './aggregation-conformance';
export * from './date-macros.zod';
// Dashboard date-range preset names (#4614 single source, re-homed by #8793) —
// declared for the dashboard date-filter positions, REFUSED as bare ordering
// comparands by filter.zod.ts and @objectstack/lint's filter-preset-comparand
// rule (#8690 C half). `ui/dashboard.zod.ts` re-exports the vocabulary.
export * from './date-range-presets';
export * from './calendar-day';
// Session-scoped filter placeholders ({current_user_id} / {current_org_id}) —
// the sibling vocabulary to date macros. Presentation scope only; RLS is the
// enforcement boundary. See context-tokens.zod.ts.
export * from './context-tokens.zod';
// `defaultValue` runtime tokens (`NOW()`, `current_user`) — the reserved string
// sentinels that are instructions, not literals. Declared once so the engine's
// insert-time default resolution and every driver's DDL agree on which
// `defaultValue`s may become a physical column DEFAULT (#4560).
export * from './default-value-tokens';
// The shape discriminator over that vocabulary (#7127): literal vs runtime
// token vs Expression envelope, plus the shared literal-vs-value-contract
// check both `defaultValue` authoring gates run (FieldSchema + ActionParam).
export * from './default-value-shape';
export * from './object.zod';
// API-method derivation — the single source of truth turning an object's
// `enable.apiMethods` whitelist into its effective operation set (#3391).
export * from './api-derivation';
// The managed-object `apiMethods` ⊆ affordances predicate — one table read by
// objectql's registration-time strip AND @objectstack/lint's authoring gate,
// so the two can never drift apart (#7521).
export * from './managed-api-affordance';
export * from './field.zod';
// The credential read mask (ADR-0100) — the ONE string a masked read serves, in
// place of the two byte-identical literals objectql and service-settings each
// declared until #7572. Both now import this one, so the mask a console sees on
// the encrypted-FIELD path cannot desynchronise from the mask it sees on the
// settings REST path.
export * from './secret-mask';
// The unknown-authoring-key lint's CORE — comparator, finding shape, curated
// guidance tables (#3786). Kept frontend-safe: the stack WALKER that imports
// every schema lives in kernel/metadata-authoring-lint.ts, so this subpath's
// bundles don't inherit the whole schema universe.
export * from './authoring-key-lint';
// Field runtime value-shape contract (ADR-0104 D1)
export * from './field-value.zod';
// Import-coercion vocabulary (#4173): the boolean/reference token tables the
// server's /import coercion and objectui's Import Wizard preview both check.
export * from './import-coercion';
export * from './autonumber-format';
export * from './validation.zod';
export * from './hook.zod';
export * from './hook-body.zod';
// The bulk-write hook dispatch contract (ADR-0058 Addendum II) — what a
// predicate (`multi: true`) write hands a lifecycle hook in BOTH phases: per-row
// dispatch, per-row `previous`, a batch-scoped payload, and one budget ceiling
// for before and after alike. Stated apart from `hook.zod.ts`'s shape table on
// purpose: that table describes the engine as BUILT (pinned in objectql), this
// one states the contract the engine is being brought to, with a `delivered`
// flag per event so "not yet" can never read as "yes".
export * from './bulk-write-hook-conformance';
export * from './mapping.zod';
export * from './data-engine.zod';
export * from './driver.zod';
export * from './driver-sql.zod';
export * from './driver-nosql.zod';

export * from './seed.zod';

// Form Layouts
export { objectForm } from './object.form';
export { fieldForm } from './field.form';
export { hookForm } from './hook.form';

// Seed Loader Protocol (Relationship Resolution & Dependency Ordering)
export * from './seed-loader.zod';

// Document Management Protocol
export * from './document.zod';

// external-lookup.zod (ExternalDataSourceSchema / ExternalFieldMappingSchema /
// ExternalLookupSchema + every type alias) was REMOVED per ADR-0049
// enforce-or-remove (#8075). The module declared a real-time external-data
// lookup protocol — a per-field external data source with an
// `authentication.config` record whose own docblock example wrote an inline
// `clientSecret` — and nothing anywhere consumed it: no metadata-type binding,
// no stack collection, no object/field embedding (`object.external` binds
// `ObjectExternalBindingSchema`, which carries no credentials), and zero
// imports outside this package in objectstack. An exported schema with no
// consumer reads as a capability to whoever finds it (#3950) — here it read as
// an invitation to put OAuth client secrets in cleartext metadata.
//
// The live mechanism external data actually goes through: `object.external`
// (`ObjectExternalBindingSchema` in object.zod.ts, ADR-0015/0062) names a
// datasource by reference, and connection credentials live in the datasource
// config (`datasource.zod.ts` / `driver/`), never inline in object metadata.
// `external-catalog.zod.ts` below is that federated path's catalog surface and
// is NOT part of this retirement. Real-time per-field lookup, if ever built,
// returns via the enforce route of ADR-0049 through a new ADR — the executor
// first, the vocabulary second. See the D3 record
// `external-lookup-message-queue-families-retired`.
export * from './datasource.zod';

// Per-driver `datasource.config` contracts (#4410) — the enforcement half of
// the `config` escape hatch DatasourceSchema leaves open at the top level.
// Exported because they are now load-bearing; nothing could import them while
// they were merely the shapes authors were TOLD to write against.
export * from './driver/index';

// The ONE definition of "what is a credential key" in a driver config, derived
// from the contracts above, plus the read-path redaction built on it (#8300 —
// moved here from service-datasource so the datasource-admin read path and the
// metadata read path's per-type redaction hook share a single security list).
export * from './datasource-credential-redaction';

// External Datasource Federation — SQL↔field type compatibility (ADR-0015)
export * from './type-compat';
export * from './external-catalog.zod';

// Analytics Protocol (Semantic Layer)
export * from './analytics.zod';

// Field → aggregation semantics (rates AVG, amounts SUM) — shared by authoring
// and build-time coherence validation.
export * from './aggregation-policy';

// Percent storage scale (0–1 fraction vs whole percentage points) — resolved
// from field metadata so renderers never guess it from the value's magnitude.
export * from './percent-scale';

// Record display-name contract (ADR-0079) — title eligibility, primary-field
// resolution/derivation, record display-name rendering, primary provisioning,
// and title-completeness classification. Shared by authoring, display
// enrichment, search field resolution, and lint.
export * from './display-name';

// `$search` field resolution (ADR-0061) — which columns a search scans.
// Shared by the objectql engine (search expansion) and the metadata-protocol
// ingress gate (#4254) so the two cannot drift.
export * from './search-fields';

// fieldGroups layout derivation (ADR-0085 §5) — the single source of the
// grouping semantics every renderer (form, detail, drawer, designer) applies.
export * from './field-group-layout';

// record-surface derivation (ADR-0085 §5) — the single source for how a record's
// create/edit/detail opens by default (full page vs drawer/modal overlay).
export * from './record-surface';

// injected-system-column derivation (#5378) — the single source for WHICH system
// columns an object carries without declaring them. Consumed by the registry's
// `applySystemFields` and by author-time tooling that must resolve a reference
// to one but cannot load a runtime.
export * from './injected-system-columns';

// injected-system-column DEFINITIONS + the #7865 provenance marker (#8116) —
// WHAT each injected column looks like, and whether storage actually backs it
// on a given object (`external` objects register anchors the platform never
// provisions). Moved here from `@objectstack/metadata-core` (which re-exports
// it) so `@objectstack/lint` — spec-only by contract — can warn at author time.
export * from './injected-system-column-provenance';

// Feed & Activity Protocol — retains only the UI activity-timeline config enums
// (FeedItemType / FeedFilterMode); the feed backend contracts were retired (ADR-0052 §5).
export * from './feed.zod';
