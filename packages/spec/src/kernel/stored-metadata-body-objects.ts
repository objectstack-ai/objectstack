// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stored-metadata family: the object (table) names whose rows carry one
 * serialized metadata BODY, and the one membership predicate every consumer
 * judges by (#21120).
 *
 * ## Why a leaf module (#21565)
 *
 * It imports nothing, on purpose. The set and its predicate were declared in
 * `metadata-type-redaction.ts`, which also carries the body redactor and so
 * imports the datasource credential derivation and, through
 * `shared/metadata-collection.zod.ts`, the conversion chain. `data/hook.zod.ts`
 * needs the predicate to refuse a hook body bound to a family table, and
 * importing it from there pulled that whole closure into the hook schema's
 * import graph. The bundler tree-shakes it away, but every source-graph walker
 * reads it, the generated `skills/objectstack-data` reference index among
 * them. Declared here, the predicate reaches a schema without that closure.
 *
 * `metadata-type-redaction.ts` re-exports both names, so every importer, and
 * the `@objectstack/spec/kernel` export, still receives these very objects.
 * ⛔ Never declare a second list of these tables anywhere: one definition is
 * the point.
 */

/**
 * [#21120] The object (table) names whose `metadata` column stores one
 * serialized metadata BODY, of the type the same row's `type` column names —
 * the table every `/meta` read exit rehydrates from (`sys_metadata`) and its
 * version snapshots (`sys_metadata_history`).
 *
 * This is the family boundary for the stored-metadata-body security invariant:
 * every surface that can SERVE, COPY or EVALUATE one of these rows' body is a
 * credential read exit, and either projects the body through the ONE redactor
 * (`redactStoredMetadataBody`, `metadata-type-redaction.ts`) or refuses. It
 * lives in `@objectstack/spec/kernel` — not in `@objectstack/metadata-protocol`
 * — because the surfaces that must consult it are service packages
 * (`@objectstack/service-analytics`), plugins (`@objectstack/plugin-audit`) and
 * the engine (`@objectstack/objectql`), and **none of them depends on
 * `@objectstack/metadata-protocol`**, while all of them already import
 * `@objectstack/spec/kernel`. A copy per surface is exactly the
 * two-definitions drift the redaction module's header refuses for its
 * registry.
 *
 * [#21520] It is also the family an app-authored body may not touch: the
 * runtime refuses to bind a hook body to one of these tables, and refuses a
 * body's write to them; [#21565] `HookSchema` refuses the same hook at parse.
 */
export const STORED_METADATA_BODY_OBJECTS: ReadonlySet<string> = new Set([
  'sys_metadata',
  'sys_metadata_history',
]);

/** Whether `object`'s rows carry a stored metadata body a read exit must project. */
export function isStoredMetadataBodyObject(object: string): boolean {
  return STORED_METADATA_BODY_OBJECTS.has(object);
}

/**
 * [#21654] The ONE prescription an author is shown when app-authored work
 * reaches for a {@link STORED_METADATA_BODY_OBJECTS} table: where a change to
 * metadata goes instead. The family has one writer for app-authored work, the
 * metadata protocol, where a change is validated and its provenance recorded
 * (#21520, ruling A), so every refusal of that reach ends on this sentence.
 *
 * Read by `HookSchema`'s refusal of a hook body bound to a family table
 * (`data/hook.zod.ts`) and by `FlowSchema`'s refusal of a write node aimed at
 * one (`automation/flow-node-config-refusals.ts`). Declared here, in the
 * import-free leaf, so both schemas reach it without the redaction module's
 * closure, and published from `@objectstack/spec/kernel` beside the set, so a
 * runtime refusal can say the same sentence by importing it rather than by
 * keeping a copy. ⛔ Never restate it in a refusal: import it.
 */
export const STORED_METADATA_BODY_PRESCRIPTION =
  'Change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`, the metadata protocol), '
  + 'where it is validated and its provenance is recorded. Elevation (`runAs`, a system context) does not '
  + 'change this.';
