// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * view-variant-model — resolves a View draft into its editable body.
 *
 * The framework exposes exactly ONE canonical, first-class shape for a view:
 * the independent **ViewItem** (ADR-0017, "Object has-many View"):
 *
 *   { name, object, viewKind: 'list' | 'form', label, config: { type, … } }
 *
 * `config` is the single view body (a ListView for `viewKind:'list'`, a
 * FormView for `viewKind:'form'`); `viewKind` is the family discriminator.
 * The legacy aggregated container ({ list, form, listViews }) is authoring
 * sugar that the backend expands into ViewItems at registration time and no
 * longer surfaces through metadata reads — so the editor consumes the ViewItem
 * shape directly, with no shape adaptation.
 *
 * A "binding" pairs the draft key the body lives under (`config`, used for
 * `onPatch` + column selection ids like `config.columns[i]`) with its logical
 * family (drives form-vs-list rendering + labels) and the body itself.
 */

/** Variant families that store a FORM-family view (no columns). */
const FORM_FAMILY = new Set(['form', 'detail']);

export interface VariantBinding {
  /** Draft key the body is stored under — always `config` for a ViewItem. */
  storeKey: string;
  /** Logical family ('list' | 'form') for labels + form detection. */
  familyKey: string;
  /** The view body object (`draft.config`). */
  schema: Record<string, unknown>;
}

/** True when a family key denotes a form-family view (no column list). */
export function isFormFamilyKey(key: string): boolean {
  return FORM_FAMILY.has(key);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Map a stored `viewKind` (+ body `type`) to a logical family key. */
function familyFromViewKind(viewKind: unknown, bodyType: unknown): string {
  if (typeof viewKind === 'string' && FORM_FAMILY.has(viewKind)) return viewKind;
  if (typeof viewKind === 'string' && viewKind) return 'list';
  // No viewKind: infer from the body's layout `type`.
  if (typeof bodyType === 'string' && FORM_FAMILY.has(bodyType)) return 'form';
  return 'list';
}

/**
 * Resolve the editable binding for a View draft. Returns a single-element
 * array (the ViewItem `config` body) or empty when the draft carries no body
 * yet (e.g. a not-yet-built create draft).
 */
export function resolveVariantBindings(
  draft: Record<string, unknown>,
): VariantBinding[] {
  const config = draft.config;
  if (isPlainObject(config)) {
    const familyKey = familyFromViewKind(draft.viewKind, config.type);
    return [{ storeKey: 'config', familyKey, schema: config }];
  }
  return [];
}

/** The view's single editable body, or undefined when none exists yet. */
export function primaryVariantBinding(
  draft: Record<string, unknown>,
): VariantBinding | undefined {
  return resolveVariantBindings(draft)[0];
}

/**
 * Resolve the binding addressed by a store key (a selection id's prefix).
 * A ViewItem has a single body, so this collapses to the primary binding.
 */
export function bindingForStoreKey(
  draft: Record<string, unknown>,
  _storeKey: string | undefined,
): VariantBinding | undefined {
  return primaryVariantBinding(draft);
}
