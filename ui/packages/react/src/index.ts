/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export * from './SchemaRenderer.js';
export * from './schema-input.js';
export * from './hooks/index.js'; // will be empty for now
export * from './context/index.js'; // will be empty for now
export * from './LazyPluginLoader.js';
export * from './data-invalidation.js';
// PageComponentSchema.dataSource — mapping the spec's per-element data binding
// onto the schema keys each object-bound block reads (objectstack#6953).
export * from './element-data-source/ElementDataSourceGate.js';
// PageComponentSchema.dataSource as the spec's API binding — the read behind
// the `data` root `SchemaRenderer` binds for it (objectui#12197).
export * from './element-data-source/useElementApiDataSource.js';

// i18n utilities
export { resolveKeyedI18nLabel } from './utils/i18n.js';

// The spec's NESTED `aria` bag (`AriaPropsSchema`) → `aria-label` /
// `aria-describedby` / `role`, with `ariaLabel` resolved as an inline locale
// map (objectui#11051). Exported for the renderers in `@object-ui/components`,
// which depends on this package, so the mapping is written once. It is not the
// flat keyed reader `SchemaRenderer` applies to every node; objectui#4580 Q2-B
// keeps the two vocabularies apart.
export { resolveInlineAriaProps } from './utils/inlineAria.js';

// "Is this a real config bag?" — the ONE definition of that question
// (objectui#6761), exported at the package entry for the same reason the node-gate
// reporter above is (objectui#6038): a surface in `@object-ui/components`, which
// depends on this package, asks it too. `element:*` renderers there read their
// config out of `{ ...schema.props, ...schema.properties }`, the third channel of
// the degenerate-bag hazard objectui#6752 / objectui#6760 closed here
// (objectui#6783). A second copy one package over would be a spelling that
// `utils/configBag.pin.test.ts` — which scans `packages/react/src` — cannot see,
// which is the drift that pin exists to stop.
export { isConfigBag } from './utils/configBag.js';

// Node-gate predicate diagnostics. Exported at the package entry (objectui#6038)
// so every surface that evaluates a node `visibleWhen` reports a fault through
// ONE reporter and ONE dedupe `Set` — `page:tabs` item predicates live in
// `@object-ui/components`, which depends on this package. A second copy of the
// reporter would mean a second rate limit, and the same broken predicate would
// then be entitled to one line per package instead of one line, which is the
// property the 2026-08-25 ruling asked for.
export {
  reportUnresolvableVisibilityPredicate,
  formatUnresolvableVisibilityMessage,
  UNRESOLVABLE_VISIBILITY_PREFIX,
  // The ENABLEMENT gate's opening line (objectui#6445). Exported beside its
  // sibling for the reason that one is: an app filtering these out of its
  // console transport filters by the constant, and a second line it cannot
  // name is a second thing to hard-code. Not a second reporter — the emit,
  // the dedupe `Set` and the reset above are still the only ones.
  UNRESOLVABLE_ENABLEMENT_PREFIX,
  __resetVisibilityPredicateWarnings,
} from './utils/visibilityDiagnostic.js';
// The per-surface scope hint those two take (objectui#6487). Exported because
// `@object-ui/app-shell` — a caller in another package — has to name its tier,
// and a caller that cannot spell the argument would be back on the node tier's
// advice by default, which is the defect that card fixed.
export type { PredicateScopeTier } from './utils/visibilityDiagnostic.js';
// Which gate the predicate was authored on (objectui#6445) — the argument that
// decides whether the message says the safe default bit or did not. Exported as
// a type for the same reason as the tier above: the reporter is public, so a
// caller has to be able to spell its arguments.
//
// ⚠️ More than two members: read the union for the set. `'concealment'`
// (objectui#6503) was added for
// the `hidden` / `hiddenOn` legs, whose verdict `SchemaRenderer` does NOT
// negate — the same fail-soft `true` that shows a node on the four negated legs
// REMOVES it there, so "the gate did NOT bite" was the one sentence that could
// not be true for them; `'withholding'` (objectui#12700) for the app-shell's
// fail-closed navigation gate. Widening a union re-exported from this entry is a
// type-level change for any consumer that switches EXHAUSTIVELY over it or
// keys a `Record` by it; no runtime signature moved, and every value that was
// accepted before still is.
export type { PredicateGateKind } from './utils/visibilityDiagnostic.js';

// Write-error surfacing utilities (shared by drag-write plugins so a failed
// PATCH — e.g. an RLS 403 — is never silently swallowed).
export { extractWriteErrorMessage, isPermissionError, extractFieldErrors, classifyLoadError, declaredUserMessage } from './utils/error-message.js';
export type { WriteFieldError, LoadErrorKind } from './utils/error-message.js';

// Built-in i18n support
export {
  I18nProvider,
  useObjectTranslation,
  useSafeTranslate,
  useObjectLabel,
  useSafeFieldLabel,
  useI18nContext,
  createI18n,
  getDirection,
  getAvailableLanguages,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatCurrency,
  formatNumber,
  type I18nConfig,
  type I18nProviderProps,
  type TranslationKeys,
  type DateFormatOptions,
  type CurrencyFormatOptions,
  type NumberFormatOptions,
} from '@object-ui/i18n';


// The platform row ceiling for NON-GRID visualisations — gantt, calendar, map
// and tree (objectui#7210, maintainer ruling a′). One constant across the
// four, because a per-plugin copy would be four constants wearing one name,
// which is the thing the ruling ruled out.
//
// HOME: `@object-ui/core`, beside the `extractRecords` it wraps (objectui#7508,
// maintainer ruling A′). This entry re-exports the three names it published
// first, the same way it re-exports `@object-ui/i18n` above, and keeps only
// the React half — `NonGridRowCeilingNote`, which takes the
// `NonGridCeilingResult` and nothing else. The probe row's `+ 1` lives in
// core's `nonGridRowCeilingQuery()` and nowhere else; the constant that used
// to carry it here is deleted, not re-exported.
export { NON_GRID_ROW_CEILING, applyNonGridRowCeiling } from '@object-ui/core';
export type { NonGridCeilingResult } from '@object-ui/core';
export { NonGridRowCeilingNote } from './utils/nonGridRowCeiling.js';
