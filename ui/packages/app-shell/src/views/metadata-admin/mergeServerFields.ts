// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * mergeServerFields — completes the cross-repo spec-skew root-cure for the
 * CURATED inspectors (report / dashboard / view).
 *
 * Background: the curated "home" inspectors derive their authoring form from
 * the BUNDLED `@objectstack/spec` (`getReportForm()`/`getReportSchema()` …).
 * When the running server adds new fields to a metadata type (e.g. report's
 * `dataset`/`rows`/`values`) before objectui bumps its bundled spec, those
 * fields exist in the live server schema (`/meta/types` → `entry.schema`) but
 * NOT in the bundled one — so the curated form can't render them. They were
 * only reachable via the raw "source" tab / API.
 *
 * `clientValidation.ts` already stopped the bundled spec from being STRICTER
 * than the server (no more false "required" banners). This is the symmetric
 * other half: let the bundled-derived FORM be a SUPERSET of the bundled spec
 * by grafting in any server-only top-level properties, so new fields become
 * directly editable in the right-hand curated form.
 *
 * It is purely ADDITIVE and lag-tolerant:
 *   - Only fields the server has and the bundle lacks are added; existing
 *     bundled fields, ordering, sections and `visibleWhen` predicates are
 *     untouched.
 *   - When the bundle catches up (the field appears in `bundledSchema`), the
 *     merge becomes a no-op for that field automatically — no shim to remove.
 *   - When no server schema is available (offline/older server), it returns
 *     the bundled `{schema, form}` verbatim.
 *
 * SchemaForm renders ONLY the fields a `form` declares (see SchemaForm's
 * sectioned path), so new properties must be added to BOTH the schema's
 * `properties` AND the form (as a trailing section) to actually surface.
 */

import type { FormViewSpec } from './SchemaForm.js';

type JsonSchema = Record<string, any>;

export interface MergeServerFieldsArgs {
  /** Bundled-spec JSONSchema for the whole document (may be undefined). */
  bundledSchema: JsonSchema | undefined;
  /** Bundled-spec authoring FormView (may be undefined). */
  bundledForm: FormViewSpec | undefined;
  /**
   * Live server JSONSchema for this type (`RichMetadataTypeEntry.schema`).
   * For nested documents (view), pass the relevant sub-schema (e.g.
   * `serverSchema.properties.list`).
   */
  serverSchema: JsonSchema | undefined;
  /**
   * Top-level fields the curated inspector renders itself (e.g. report's
   * `objectName`/`columns`/`label`) plus identity (`name`). These are never
   * grafted into the spec form even if the server adds/keeps them, so they
   * are not double-edited.
   */
  excludeFields: Set<string>;
  /** Localized title for the trailing "new server fields" section. */
  sectionTitle: string;
}

export interface MergeServerFieldsResult {
  schema: JsonSchema | undefined;
  form: FormViewSpec | undefined;
}

/** Collect every field name a FormView's sections already declare. */
function formDeclaredFields(form: FormViewSpec | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of form?.sections ?? []) {
    for (const f of s.fields ?? []) {
      out.add(typeof f === 'string' ? f : (f as any)?.field);
    }
  }
  return out;
}

/**
 * Return `{schema, form}` with server-only top-level properties grafted onto
 * the bundled pair. No-op (returns the bundled pair) when there is nothing to
 * add or no server schema to read.
 */
export function mergeServerFields({
  bundledSchema,
  bundledForm,
  serverSchema,
  excludeFields,
  sectionTitle,
}: MergeServerFieldsArgs): MergeServerFieldsResult {
  if (!bundledSchema) return { schema: bundledSchema, form: bundledForm };

  const serverProps = serverSchema?.properties as
    | Record<string, JsonSchema>
    | undefined;
  if (!serverProps || typeof serverProps !== 'object') {
    return { schema: bundledSchema, form: bundledForm };
  }

  const bundledProps = (bundledSchema.properties ?? {}) as Record<string, JsonSchema>;
  const alreadyShown = formDeclaredFields(bundledForm);

  // Server-only fields = on the server, absent from the bundled schema, not
  // curated-owned, and not already declared by the bundled form.
  const newKeys = Object.keys(serverProps).filter(
    (k) =>
      !(k in bundledProps) &&
      !excludeFields.has(k) &&
      !alreadyShown.has(k),
  );
  if (newKeys.length === 0) return { schema: bundledSchema, form: bundledForm };

  // ── additive schema merge (shallow clone; bundled defs win on conflict) ──
  const mergedSchema: JsonSchema = {
    ...bundledSchema,
    properties: { ...bundledProps },
  };
  for (const k of newKeys) {
    if (!(k in mergedSchema.properties)) mergedSchema.properties[k] = serverProps[k];
  }

  // ── additive form merge — append a trailing section with the new fields ──
  // When the bundle ships no form at all, SchemaForm falls back to a flat
  // property list (which already renders every property), so we only need to
  // synthesise a form when one exists to preserve its curated layout.
  let mergedForm = bundledForm;
  if (bundledForm && typeof bundledForm === 'object') {
    // A shallow copy, not a JSON round-trip: the bundled field objects are
    // handed on as they are, because a localized form carries each field's
    // pre-translation label under a symbol key that `JSON.stringify` drops —
    // and without it the machine-name chip judges the translated label again
    // (objectui#8231, `untranslatedFieldLabel`). Nothing below mutates them;
    // the only change is the appended section, on a fresh array.
    mergedForm = {
      ...bundledForm,
      sections: [
        ...(bundledForm.sections ?? []),
        { label: sectionTitle, fields: newKeys.map((field) => ({ field })) },
      ],
    };
  }

  return { schema: mergedSchema, form: mergedForm };
}
