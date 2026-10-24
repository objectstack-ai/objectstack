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

let _viewDocSchema: JsonSchema | undefined;
let _viewDocFailed = false;

function viewDocSchema(): JsonSchema | undefined {
  if (_viewDocSchema || _viewDocFailed) return _viewDocSchema;
  try {
    _viewDocSchema = z.toJSONSchema(ViewSchema, TO_JSON_OPTS) as JsonSchema;
  } catch (err) {
    _viewDocFailed = true;
    if (typeof console !== 'undefined') {
      console.warn('[view-schema] failed to derive View JSONSchema from spec', err);
    }
  }
  return _viewDocSchema;
}

/** JSONSchema for a single LIST-family view (grid/kanban/calendar/…). */
export function getListVariantSchema(): JsonSchema | undefined {
  return viewDocSchema()?.properties?.list;
}

/** JSONSchema for a single FORM-family view. */
export function getFormVariantSchema(): JsonSchema | undefined {
  return viewDocSchema()?.properties?.form;
}

let _listColumnSchema: JsonSchema | undefined;
let _listColumnFailed = false;

/** JSONSchema for a single list column (ListColumn). */
export function getListColumnSchema(): JsonSchema | undefined {
  if (_listColumnSchema || _listColumnFailed) return _listColumnSchema;
  try {
    _listColumnSchema = z.toJSONSchema(ListColumnSchema, TO_JSON_OPTS) as JsonSchema;
  } catch (err) {
    _listColumnFailed = true;
    if (typeof console !== 'undefined') {
      console.warn('[view-schema] failed to derive ListColumn JSONSchema from spec', err);
    }
  }
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
  try {
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
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[view-schema] failed to prepare viewForm from spec', err);
    }
    return undefined;
  }
  return _viewForm;
}
