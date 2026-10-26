// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Is this field a column the PLATFORM injected and keeps out of every default
 * UI, so Studio's Data pillar keeps it out of the author's views too
 * (objectui#11780)?
 *
 * The test is the platform's own pair of marks on the served field definition:
 * `system: true` AND `hidden: true`, together. objectstack stamps both on the
 * columns it injects for its own bookkeeping — the search companion `__search`
 * (`provisionSearchCompanion`), `owning_business_unit_id`
 * (`OWNING_BUSINESS_UNIT_FIELD_DEF`) and the tenant anchor `organization_id`
 * (`TENANT_SCOPE_FIELD_DEF`). The runtime list already drops them; before this
 * predicate the records grid, the Form preview and the form designer showed
 * them to every author, because those readers knew only a fixed name list.
 *
 * Why BOTH marks, and neither one alone:
 *
 * - `system` alone is too wide. It also marks the audit columns and the
 *   reassignable `owner_id`, which the platform injects but does NOT hide —
 *   `owner_id` is an editable business field an author designs a form around.
 * - `hidden` alone is too wide the other way. An author who hides one of their
 *   OWN fields still manages it here: its grid column and its designer card are
 *   how the author reaches the inspector to un-hide it. Filtering on `hidden`
 *   alone would strand that field with no way back to it.
 *
 * Read the marks as booleans and nothing else: the spec declares both keys
 * `z.boolean()`, so a truthy non-boolean is not a mark.
 *
 * ⛔ This decides what Studio SHOWS, never what it keeps. Every caller hides
 * such a field from a view and leaves it in `objDraft.fields`; the form
 * designer writes it back with its definition untouched (see
 * `ObjectFormDesigner`'s `commit`).
 *
 * Not on the package entry: Studio-internal, like the name list beside it.
 */
export function isStudioHiddenSystemField(def: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return def?.system === true && def?.hidden === true;
}
