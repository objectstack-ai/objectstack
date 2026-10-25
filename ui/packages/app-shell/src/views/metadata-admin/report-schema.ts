// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * report-schema.ts — the SINGLE source of truth for Report authoring
 * metadata, sourced directly from `@objectstack/spec` (the protocol) rather
 * than hand-written field lists. Mirrors {@link ./view-schema.ts}.
 *
 * Why: the Report inspector must render the CORRECT config fields for EVERY
 * report type (tabular / summary / matrix / joined) without hardcoding them.
 * The spec already describes this:
 *
 *   • `reportForm`   — the canonical authoring FormView: sections for basics,
 *                      columns, groupings, joined blocks, filter & chart, and
 *                      advanced. One section (joined blocks) is type-
 *                      conditional via a `visibleWhen` CEL predicate.
 *   • `ReportSchema` — the zod schema for the whole (flat) Report document.
 *
 * We convert the zod schema to JSONSchema once (memoised) via zod 4's native
 * `z.toJSONSchema`, and feed `{ form, schema }` straight into the existing
 * {@link SchemaForm}. Adding a new report type or config prop to the spec
 * therefore flows through automatically — zero code changes here.
 */

import { z } from 'zod';
import { ReportSchema, reportForm as specReportForm } from '@objectstack/spec/ui';
import type { FormViewSpec } from './SchemaForm.js';

type JsonSchema = Record<string, any>;

const TO_JSON_OPTS = { io: 'input', unrepresentable: 'any' } as const;

/** Fields the curated inspector owns directly, pruned from the spec form. */
const FORM_FIELDS_OWNED_ELSEWHERE = new Set([
  'dataset', // dataset binding rendered as a dedicated picker
  'values', // managed by the dedicated measures list
  'rows', // managed by the dedicated dimensions list
  'columns', // matrix across-dimensions — dedicated list (ADR-0021 D2)
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
let _reportDocSchema: JsonSchema | undefined;

/** JSONSchema for the whole (flat) Report document. */
export function getReportSchema(): JsonSchema {
  _reportDocSchema ??= z.toJSONSchema(ReportSchema, TO_JSON_OPTS) as JsonSchema;
  return _reportDocSchema;
}

let _reportForm: FormViewSpec | undefined;

/**
 * The canonical authoring FormView, with the fields the curated inspector
 * owns directly (dataset / values / rows / name) pruned from every section so
 * they are not double-rendered. Everything else — including the type-
 * conditional joined-blocks section — flows through verbatim from the spec.
 *
 * Two alignment passes on top of the verbatim clone:
 *
 * 1. Fields the form declares but the *schema* no longer carries are pruned.
 *    The 9.0 single-form cutover removed the query-form fields (`objectName` /
 *    `columns` / `groupingsDown` / `groupingsAcross` / `filter`) from
 *    `ReportSchema`, but the bundled `reportForm` may still declare them (the
 *    spec-side form fix ships separately) — rendering controls whose output
 *    the schema strips at parse time. The schema is the source of truth; the
 *    pass is a no-op once the bundled form catches up.
 *
 * 2. `runtimeFilter` (which replaced `filter` in 9.0) is appended when the
 *    schema carries it and no section declares it, so the render-time scope
 *    filter stays editable in the meantime.
 */
export function getReportForm(): FormViewSpec | undefined {
  if (_reportForm) return _reportForm;
  if (!specReportForm || typeof specReportForm !== 'object') return undefined;
  const clone = JSON.parse(JSON.stringify(specReportForm)) as FormViewSpec;
  const schemaProps = getReportSchema().properties as Record<string, unknown> | undefined;
  for (const section of clone.sections ?? []) {
    section.fields = (section.fields ?? []).filter((f: any) => {
      const name = typeof f === 'string' ? f : f?.field;
      if (FORM_FIELDS_OWNED_ELSEWHERE.has(name)) return false;
      // Schema-subset pass: drop form fields the schema no longer carries.
      if (schemaProps && !(name in schemaProps)) return false;
      return true;
    });
  }
  if (schemaProps && 'runtimeFilter' in schemaProps) {
    const declared = new Set<string>();
    for (const s of clone.sections ?? []) {
      for (const f of s.fields ?? []) {
        declared.add(typeof f === 'string' ? f : (f as any)?.field);
      }
    }
    if (!declared.has('runtimeFilter')) {
      clone.sections = [
        ...(clone.sections ?? []),
        {
          label: 'Filter',
          description: 'Render-time scope filter, ANDed at query time.',
          collapsible: true,
          collapsed: true,
          fields: [{ field: 'runtimeFilter', widget: 'json' }],
        },
      ];
    }
  }
  // Drop now-empty sections so we don't render bare headers.
  clone.sections = (clone.sections ?? []).filter(
    (s: any) => (s.fields ?? []).length > 0,
  );
  _reportForm = clone;
  return _reportForm;
}
