// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export * from './query.zod';
export * from './filter.zod';
// Canonical conformance cases for the filter logical combinators — the shared
// standard the five independent FilterCondition backends are each checked
// against, so they cannot drift apart again (#3774; the fifth — MongoDB's
// `translateFilter` — was enrolled by #4405).
export * from './filter-logic-conformance';
// Canonical conformance cases for the filter TEXT operators — case folding
// (ASCII-only, #4706 Q1), literal comparands (no LIKE wildcards, no regex
// metacharacters), and the refusal of the retired `$regex`/`$options`. A
// sibling of the logic table rather than rows inside it: those two axes are
// explicitly out of that table's scope, and this one needs an `expectRejection`
// discriminant it deliberately never grew (#5701).
export * from './filter-text-conformance';
export * from './temporal-conformance';
// Canonical conformance cases for deterministic paged reads — the standard
// every driver's `find()` is held to whenever `limit`/`offset` slice the result
// set, so neither a sort key that fails to identify a row (#3106) nor the
// absence of one altogether (#4363) can let pages overlap or skip.
export * from './pagination-conformance';
export * from './date-macros.zod';
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
export * from './object.zod';
// API-method derivation — the single source of truth turning an object's
// `enable.apiMethods` whitelist into its effective operation set (#3391).
export * from './api-derivation';
export * from './field.zod';
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

// External Lookup Protocol
export * from './external-lookup.zod';
export * from './datasource.zod';

// Per-driver `datasource.config` contracts (#4410) — the enforcement half of
// the `config` escape hatch DatasourceSchema leaves open at the top level.
// Exported because they are now load-bearing; nothing could import them while
// they were merely the shapes authors were TOLD to write against.
export * from './driver/index';

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
// `applySystemFields` (which owns the column definitions) and by author-time
// tooling that must resolve a reference to one but cannot load a runtime.
export * from './injected-system-columns';

// Feed & Activity Protocol — retains only the UI activity-timeline config enums
// (FeedItemType / FeedFilterMode); the feed backend contracts were retired (ADR-0052 §5).
export * from './feed.zod';
