// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * page-schema.ts — the SINGLE source of truth for Page authoring metadata,
 * sourced directly from `@objectstack/spec/ui` (the protocol) rather than
 * hand-written field lists. Mirrors {@link ../report-schema} / view-schema.
 *
 * Why: the Page inspector must render the CORRECT config fields for every page
 * type without hardcoding them. An interface/list page (kanban / calendar /
 * gallery / gantt board — `type: 'list'` + `interfaceConfig.source`) has no
 * block tree, so the block inspector never fires; the default panel needs a
 * form for `interfaceConfig` (source / columns / appearance.
 * allowedVisualizations / userActions / showRecordCount). The spec already
 * describes all of this:
 *
 *   • `pageForm`   — the canonical authoring FormView: sections with
 *                    type-conditional `visibleWhen` predicates.
 *   • `PageSchema` — the zod schema for the whole Page document.
 *
 * We convert the zod schema to JSONSchema once (memoised) via zod 4's native
 * `z.toJSONSchema` and feed `{ form, schema }` straight into {@link SchemaForm}.
 * Adding a new page type or config prop to the spec flows through automatically
 * — zero code changes here.
 */

import { z } from 'zod';
import { PageSchema, pageForm as specPageForm } from '@objectstack/spec/ui';
import type { FormViewSpec } from './SchemaForm.js';

type JsonSchema = Record<string, any>;

const TO_JSON_OPTS = { io: 'input', unrepresentable: 'any' } as const;

/**
 * Fields the design canvas / identity own, pruned from the spec form and
 * hidden on the SchemaForm so they are not (double-)rendered in the panel:
 *   • `name`               — record identity (renamed elsewhere).
 *   • `regions` / `children` — the block tree, edited on the canvas.
 */
export const PAGE_FIELDS_OWNED_ELSEWHERE = new Set(['name', 'regions', 'children']);

let _pageSchema: JsonSchema | undefined;
let _pageSchemaFailed = false;

/** JSONSchema for the whole Page document (memoised, spec-derived). */
export function getPageSchema(): JsonSchema | undefined {
  if (_pageSchema || _pageSchemaFailed) return _pageSchema;
  try {
    _pageSchema = z.toJSONSchema(PageSchema, TO_JSON_OPTS) as JsonSchema;
  } catch (err) {
    _pageSchemaFailed = true;
    if (typeof console !== 'undefined') {
      console.warn('[page-schema] failed to derive Page JSONSchema from spec', err);
    }
  }
  return _pageSchema;
}

let _pageForm: FormViewSpec | undefined;

/**
 * The canonical authoring FormView, with the canvas/identity-owned fields
 * pruned from every section (so they are not double-rendered and no bare
 * section header is left behind). Everything else — including the
 * type-conditional `interfaceConfig` sections — flows through verbatim.
 */
export function getPageForm(): FormViewSpec | undefined {
  if (_pageForm) return _pageForm;
  if (!specPageForm || typeof specPageForm !== 'object') return undefined;
  try {
    const clone = JSON.parse(JSON.stringify(specPageForm)) as FormViewSpec;
    for (const section of clone.sections ?? []) {
      section.fields = (section.fields ?? []).filter((f: any) => {
        const name = typeof f === 'string' ? f : f?.field;
        return !PAGE_FIELDS_OWNED_ELSEWHERE.has(name);
      });
    }
    clone.sections = (clone.sections ?? []).filter((s) => (s.fields ?? []).length > 0);
    _pageForm = clone;
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[page-schema] failed to prune Page authoring form from spec', err);
    }
    _pageForm = specPageForm as FormViewSpec;
  }
  return _pageForm;
}
