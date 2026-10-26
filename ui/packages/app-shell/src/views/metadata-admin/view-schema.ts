// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * view-schema.ts — the SINGLE source of truth for View authoring metadata,
 * sourced directly from `@objectstack/spec` (the protocol) rather than
 * hand-written field lists.
 *
 * Why: the View inspector must render the CORRECT config fields for EVERY
 * view type (grid / kanban / calendar / gallery / gantt / timeline / chart)
 * without hardcoding them. The spec already describes this:
 *
 *   • `viewForm`     — the canonical authoring FormView: sections with
 *                      type-conditional `visibleWhen` CEL predicates
 *                      (`data.type == 'kanban'`, …). One section per view
 *                      type, plus shared basics / filters / navigation.
 *   • `ViewSchema`   — the zod schema for the whole (nested) View document.
 *                      `properties.list` is the JSONSchema for a single
 *                      list-family view; `properties.form` for a form view.
 *   • `ListColumnSchema` — per-column property schema (width / align /
 *                      pinned / summary / …).
 *
 * We convert the zod schemas to JSONSchema once (memoised) via zod 4's
 * native `z.toJSONSchema`, and feed `{ form, schema }` straight into the
 * existing {@link SchemaForm}. Adding a new view type or config prop to the
 * spec therefore flows through automatically — zero code changes here.
 */

import { z } from 'zod';
import {
  ViewSchema,
  ListColumnSchema,
  viewForm as specViewForm,
} from '@objectstack/spec/ui';
import type { FormViewSpec } from './SchemaForm.js';

type JsonSchema = Record<string, any>;

const TO_JSON_OPTS = { io: 'input', unrepresentable: 'any' } as const;

/** Fields the curated inspector owns directly, pruned from the spec form. */
const FORM_FIELDS_OWNED_ELSEWHERE = new Set([
  'columns', // managed by the live column canvas + per-column inspector
  'data', // object binding rendered as a dedicated control
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
let _viewDocSchema: JsonSchema | undefined;

function viewDocSchema(): JsonSchema {
  _viewDocSchema ??= z.toJSONSchema(ViewSchema, TO_JSON_OPTS) as JsonSchema;
  return _viewDocSchema;
}

/** JSONSchema for a single LIST-family view (grid/kanban/calendar/…). */
export function getListVariantSchema(): JsonSchema | undefined {
  return viewDocSchema().properties?.list;
}

/** JSONSchema for a single FORM-family view. */
export function getFormVariantSchema(): JsonSchema | undefined {
  return viewDocSchema().properties?.form;
}

let _listColumnSchema: JsonSchema | undefined;

/** JSONSchema for a single list column (ListColumn). */
export function getListColumnSchema(): JsonSchema {
  _listColumnSchema ??= z.toJSONSchema(ListColumnSchema, TO_JSON_OPTS) as JsonSchema;
  return _listColumnSchema;
}

let _viewForm: FormViewSpec | undefined;

/**
 * The canonical authoring FormView, with the fields the curated inspector
 * owns directly (columns / data / name) pruned from every section so they
 * are not double-rendered. Everything else — including the type-conditional
 * per-view-type sections — flows through verbatim from the spec.
 */
export function getViewForm(): FormViewSpec | undefined {
  if (_viewForm) return _viewForm;
  if (!specViewForm || typeof specViewForm !== 'object') return undefined;
  const clone = JSON.parse(JSON.stringify(specViewForm)) as FormViewSpec;
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
  _viewForm = clone;
  return _viewForm;
}
