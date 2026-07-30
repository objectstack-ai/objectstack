// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export * from './query.zod';
export * from './filter.zod';
// Canonical conformance cases for the filter logical combinators — the shared
// standard the four independent FilterCondition backends are each checked
// against, so they cannot drift apart again (#3774).
export * from './filter-logic-conformance';
export * from './temporal-conformance';
export * from './date-macros.zod';
export * from './calendar-day';
// Session-scoped filter placeholders ({current_user_id} / {current_org_id}) —
// the sibling vocabulary to date macros. Presentation scope only; RLS is the
// enforcement boundary. See context-tokens.zod.ts.
export * from './context-tokens.zod';
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

// External Datasource Federation — SQL↔field type compatibility (ADR-0015)
export * from './type-compat';
export * from './external-catalog.zod';

// Analytics Protocol (Semantic Layer)
export * from './analytics.zod';

// Field → aggregation semantics (rates AVG, amounts SUM) — shared by authoring
// and build-time coherence validation.
export * from './aggregation-policy';

// Record display-name contract (ADR-0079) — title eligibility, primary-field
// resolution/derivation, record display-name rendering, primary provisioning,
// and title-completeness classification. Shared by authoring, display
// enrichment, search field resolution, and lint.
export * from './display-name';

// fieldGroups layout derivation (ADR-0085 §5) — the single source of the
// grouping semantics every renderer (form, detail, drawer, designer) applies.
export * from './field-group-layout';

// record-surface derivation (ADR-0085 §5) — the single source for how a record's
// create/edit/detail opens by default (full page vs drawer/modal overlay).
export * from './record-surface';

// Feed & Activity Protocol — retains only the UI activity-timeline config enums
// (FeedItemType / FeedFilterMode); the feed backend contracts were retired (ADR-0052 §5).
export * from './feed.zod';
