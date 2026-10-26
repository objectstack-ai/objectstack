// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dashboard-schema.ts — the SINGLE source of truth for Dashboard authoring
 * metadata, sourced directly from `@objectstack/spec` (the protocol) rather
 * than hand-written field lists. Mirrors {@link ./report-schema.ts}.
 *
 * Why: the Dashboard inspector must render the CORRECT config fields
 * (layout / filters / performance / …) without hardcoding them. The spec
 * already describes this:
 *
 *   • `dashboardForm`   — the canonical authoring FormView: sections for
 *                         basics, layout, widgets, filters and advanced.
 *   • `DashboardSchema` — the zod schema for the whole (flat) Dashboard
 *                         document (name / label / widgets[] / columns /
 *                         gap / dateRange / globalFilters / performance / …).
 *
 * We convert the zod schema to JSONSchema once (memoised) via zod 4's native
 * `z.toJSONSchema`, and feed `{ form, schema }` straight into the existing
 * {@link SchemaForm}. Adding a new dashboard config prop to the spec therefore
 * flows through automatically — zero code changes here.
 */

import { z } from 'zod';
import { DashboardSchema, dashboardForm as specDashboardForm } from '@objectstack/spec/ui';
import type { FormViewSpec } from './SchemaForm.js';
import type { SupportedLocale } from './i18n.js';
import { localizeMetadataForm } from './metadata-form-i18n.js';

type JsonSchema = Record<string, any>;

const TO_JSON_OPTS = { io: 'input', unrepresentable: 'any' } as const;

/** Fields the curated inspector owns directly, pruned from the spec form. */
const FORM_FIELDS_OWNED_ELSEWHERE = new Set([
  'widgets', // managed by the dedicated widgets list + per-widget inspector
  'label', // dashboard display name rendered as a dedicated control
  'description', // rendered as a dedicated control
  'name', // record identity — not user-editable here
]);

/**
 * No `try`/`catch` around the spec derivations in this file (objectui#13459).
 * Their only input is the bundled `@objectstack/spec`, so a derivation that
 * fails is a build-time fact: the tests beside this file go red, and at runtime
 * the throw reaches the route's error boundary. It used to be caught, warned
 * about in the console and turned into `undefined`, which rendered a designer
 * form silently missing fields that the author could then save past.
 */
let _dashboardDocSchema: JsonSchema | undefined;

/** JSONSchema for the whole (flat) Dashboard document. */
export function getDashboardSchema(): JsonSchema {
  _dashboardDocSchema ??= z.toJSONSchema(DashboardSchema, TO_JSON_OPTS) as JsonSchema;
  return _dashboardDocSchema;
}

/**
 * Per-locale, because the form now carries LOCALIZED copy (objectui#7254) and
 * a single slot would have served whichever locale asked first to everyone
 * after it — a cache that is right until someone switches language.
 */
const _dashboardForm = new Map<string, FormViewSpec | undefined>();

/**
 * The canonical authoring FormView, with the fields the curated inspector
 * owns directly (widgets / label / description / name) pruned from every
 * section so they are not double-rendered. Everything else — layout,
 * filters, performance — flows through verbatim from the spec.
 *
 * The spec authors these strings in English. `localizeMetadataForm` overlays
 * the active locale on top (objectui#7254) through the platform's own
 * `metadataForms.<type>` convention, so the panel speaks the same language as
 * the Studio around it. A locale the overlay does not carry gets the spec's
 * English, exactly as before.
 */
export function getDashboardForm(locale?: SupportedLocale | string): FormViewSpec | undefined {
  const cacheKey = String(locale ?? '');
  if (_dashboardForm.has(cacheKey)) return _dashboardForm.get(cacheKey);
  if (!specDashboardForm || typeof specDashboardForm !== 'object') return undefined;
  const clone = JSON.parse(JSON.stringify(specDashboardForm)) as FormViewSpec;
  for (const section of clone.sections ?? []) {
    section.fields = (section.fields ?? []).filter((f: any) => {
      const name = typeof f === 'string' ? f : f?.field;
      return !FORM_FIELDS_OWNED_ELSEWHERE.has(name);
    });
  }
  // Drop now-empty sections so we don't render bare headers.
  clone.sections = (clone.sections ?? []).filter(
    (s: any) => (s.fields ?? []).length > 0,
  );
  // Localize AFTER pruning: the overlay only has to reach what renders, and
  // pruning cannot drop a section the overlay just renamed.
  const localized = localizeMetadataForm(
    clone as unknown as Record<string, unknown>,
    'dashboard',
    locale,
  ) as unknown as FormViewSpec;
  _dashboardForm.set(cacheKey, localized);
  return localized;
}
