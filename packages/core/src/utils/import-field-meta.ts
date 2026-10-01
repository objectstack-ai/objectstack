// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The field-name → field-metadata map the bulk-import runner and its cell
 * coercion read. Moved here unchanged from `@objectstack/rest`
 * (`export-format.ts`), which re-exports both names: the runner moved beside
 * {@link bulkWrite} so the connector sync executor in
 * `@objectstack/service-automation` can write through it without depending on
 * the HTTP layer, and this map is the half of the export formatter the runner
 * needs. The export renderers stay in `rest`.
 */

export interface ExportFieldMeta {
  name: string;
  type?: string;
  label?: string;
  options?: Array<{ label?: string; value?: unknown; color?: string }>;
  /** Target object for lookup / master_detail / user fields. */
  reference?: string;
  /** Field on the referenced record to show as its label. */
  displayField?: string;
  /** Field holds multiple values (an array), e.g. a `multiple: true` lookup. */
  multiple?: boolean;
  // Every key above is a PRESENTATION key: each one is read to turn a storage
  // value into a readable cell (or a readable cell back into a storage value).
  //
  // ── retired: the eight constraint keys (#6536) ──────────────────────
  //
  // `required` / `system` / `readonly` / `hasDefault` / `min` / `max` /
  // `minLength` / `maxLength` used to sit here. They were added for the import
  // dry run's hand-copied pre-check mirror (`firstMissingRequiredField` /
  // `firstConstraintViolation`, framework#3956); #4633 ruling D retired that
  // mirror (PR #6532) — the dry run now asks the engine for its verdict through
  // `DataProtocol.validateData`, which reads the object's own schema. That left
  // all eight computed on every import and read by nothing, so ADR-0049
  // enforce-or-remove retires them rather than leaving a constraint vocabulary
  // standing next to the presentation one with no enforcer behind it.
  //
  // They were never a source of truth: `buildFieldMetaMap` derived each one
  // from the very `schema` its caller passed in, so a caller that wants a
  // field's constraints reads them off that schema (`fields[name].required`, …)
  // — the same place the engine reads them.
}

/**
 * Build a field-name → metadata map from an object schema (best-effort).
 *
 * Accepts both shapes `fields` appears in across the stack: the runtime
 * `ObjectSchema.fields` is a `Record<fieldName, FieldDefinition>` object map
 * (the form served by the engine registry / `getMetaItem`), while some callers
 * and fixtures hand back a plain `FieldDefinition[]` array. A field's name is
 * taken from its own `name`, falling back to the map key.
 */
export function buildFieldMetaMap(schema: unknown): Map<string, ExportFieldMeta> {
  const map = new Map<string, ExportFieldMeta>();
  const fields = (schema as { fields?: unknown })?.fields;

  // Normalize either shape to a list of [name, definition] entries.
  let entries: Array<[string, any]>;
  if (Array.isArray(fields)) {
    entries = fields
      .filter((f) => f && typeof f === 'object')
      .map((f) => [typeof f.name === 'string' ? f.name : '', f] as [string, any]);
  } else if (fields && typeof fields === 'object') {
    entries = Object.entries(fields as Record<string, any>).map(
      ([key, def]) => [
        def && typeof def === 'object' && typeof def.name === 'string' ? def.name : key,
        def,
      ] as [string, any],
    );
  } else {
    return map;
  }

  for (const [name, f] of entries) {
    if (!name || !f || typeof f !== 'object') continue;
    map.set(name, {
      name,
      type: typeof f.type === 'string' ? f.type : undefined,
      label: typeof f.label === 'string' ? f.label : undefined,
      options: Array.isArray(f.options) ? f.options : undefined,
      reference: typeof f.reference === 'string' ? f.reference : undefined,
      displayField: typeof f.displayField === 'string' ? f.displayField : undefined,
      multiple: f.multiple === true,
    });
  }
  return map;
}
