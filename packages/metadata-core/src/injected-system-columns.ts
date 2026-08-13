// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The served-document injection / strip pair over the injected-system-column
 * definition tables (objectstack#6562, ruled Option B) — and the re-export shim
 * for the tables and the #7865 provenance derivation, which moved to
 * `@objectstack/spec/data` in #8116.
 *
 * ## Where the pieces live now, and why
 *
 * `resolveInjectedSystemColumns` (`@objectstack/spec/data`, #5378) is the one
 * answer to *"WHICH columns does the platform provision on THIS object without
 * the author declaring them?"*. The column DEFINITIONS (WHAT each one looks
 * like — `AUDIT_FIELD_DEFS` and its three siblings), the derived per-object
 * `injectedSystemColumnDefs`, and the #7865 PROVENANCE derivation over them
 * (`platformProvisionsStorage` / `resolveInjectedColumnProvenance` /
 * `unprovisionedInjectedColumns`) live beside it in
 * `injected-system-column-provenance.ts` since #8116: `@objectstack/lint`'s
 * package contract is "depends on `@objectstack/spec`; never on a runtime", so
 * a marker only this package exported was structurally unreachable from the
 * author-time surface, and an expression over an unprovisioned anchor on an
 * ADR-0015 `external` object linted clean while degrading silently at query
 * time. The maintainer ruling on #8116 (2026-08-12) sank the derivation into
 * the contract package (option 1) rather than grant lint a dependency
 * exception; **this module re-exports every moved name, so its public surface
 * — and every downstream import — is unchanged.**
 *
 * What stays HERE is the served-document pair below (#6562): it is runtime
 * document transformation for the `/meta` read/write path, not contract, and
 * moving it was explicitly out of #8116's scope. History of the earlier hops
 * (objectql → metadata-core by #6562, for the same sink-into-a-shared-package
 * reason; the retired `indexed` key, #6810) is preserved in the moved module's
 * docs and in #6562/#8115.
 *
 * ## Why a `/meta` read needs the pair at all (#6562)
 *
 * `GET /api/v1/meta/object/:name` answered a **different set of fields**
 * depending on which link of its resolution chain produced the answer:
 *
 *  - registry-backed → the schema AFTER `applySystemFields`, carrying
 *    `created_at` / `created_by` / `updated_at` / `updated_by` /
 *    `organization_id` / `owner_id` / `owning_business_unit_id` even when the
 *    author declared none of them;
 *  - overlay-backed (a `sys_metadata` row, or a MetadataService body) → the
 *    stored document VERBATIM, so every one of those columns was simply absent.
 *
 * Whether an object carries an overlay is invisible to the caller, so the same
 * request reported the platform's own columns or not, and nothing said which had
 * happened. An author reading the overlay-backed answer concludes the columns do
 * not exist — while every one of them is real in the database, filterable,
 * orderable and enforced read-only on write. The maintainer's ruling
 * (2026-08-08) is Option B: the read serves the EFFECTIVE runtime schema, and
 * the overlay-backed minority path converges on the registry-backed majority.
 */

import {
  injectedSystemColumnDefs,
  isInjectedColumnDefinition,
} from '@objectstack/spec/data';

// [#8116] Re-export shim — the definition tables and the #7865 provenance
// derivation moved to `@objectstack/spec/data` so author-time consumers can
// reach them; everything this module exported before the move is re-exported
// here unchanged (the ruling's "nothing downstream breaks" fence — the #7865
// producer test file pins it by importing from this package's index).
export {
  AUDIT_FIELD_DEFS,
  TENANT_SCOPE_FIELD_DEF,
  OWNER_FIELD_DEF,
  OWNING_BUSINESS_UNIT_FIELD_DEF,
  injectedSystemColumnDefs,
  platformProvisionsStorage,
  resolveInjectedColumnProvenance,
  unprovisionedInjectedColumns,
} from '@objectstack/spec/data';
export type { InjectedColumnProvenance } from '@objectstack/spec/data';

/** The `fields` record of a metadata document, or `undefined` when it has none. */
function fieldsOf(doc: unknown): Record<string, unknown> | undefined {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return undefined;
  const fields = (doc as Record<string, unknown>).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  return fields as Record<string, unknown>;
}

/**
 * Add every injected system column the object carries but does not declare, so a
 * served object document reports the EFFECTIVE runtime schema (#6562).
 *
 * The merge direction is `applySystemFields`': injected definitions **lose** to
 * a declared field of the same name, because a declared `owner_id` is the
 * author's field and the registry lets it win. (The audit family's *governance*
 * — the keys that decide who may write it — is the other half, and stays with
 * {@link applyAuditFieldGovernance}: this function only adds absent columns, it
 * never rewrites a declared one.)
 *
 * A document with no `fields` record is returned untouched, deliberately: the
 * write-side {@link stripInjectedSystemColumns} could not tell an emptied
 * `fields: {}` from one that was never there, and the #4326 byte-identical
 * round-trip invariant is what that symmetry protects.
 *
 * Returns the **same reference** when nothing needed adding, so the
 * registry-sourced path (already injected at registration) pays a comparison and
 * no copy. Pure and total — any record may be handed to it.
 */
export function applyInjectedSystemColumns<T>(doc: T): T {
  const declared = fieldsOf(doc);
  if (declared === undefined) return doc;

  let additions: Record<string, unknown> | undefined;
  for (const [name, def] of Object.entries(injectedSystemColumnDefs(doc))) {
    if (declared[name] !== undefined) continue;
    additions ??= {};
    additions[name] = { ...def };
  }
  if (additions === undefined) return doc;

  return {
    ...(doc as unknown as Record<string, unknown>),
    fields: { ...additions, ...declared },
  } as unknown as T;
}

/**
 * The write-side counterpart of {@link applyInjectedSystemColumns}: remove the
 * injected-but-undeclared columns a served document picked up on its way out, so
 * the standard Studio GET → edit → PUT round-trip still persists a
 * **byte-identical** body (#4326).
 *
 * Same discipline, and the same reason, as `stripReadDecorations`
 * (`@objectstack/spec/kernel`): the write path persists the request body verbatim
 * by design (ADR-0005 §Validation), so anything the READ adds must be removed
 * again on the way in or it is baked into `sys_metadata.metadata`, into its
 * checksum, and into every history diff. It is not the same *list*, though, and
 * must not be folded into that one — a read decoration is derived diagnostics
 * that no schema accepts, whereas these are real, spec-valid field declarations
 * an author may legitimately write. Hence the exactness of
 * `isInjectedColumnDefinition` (`@objectstack/spec/data`): only a field
 * identical to the platform's own is removed.
 *
 * Returns the **same reference** when nothing needed removing. Pure and total.
 */
export function stripInjectedSystemColumns<T>(doc: T): T {
  const declared = fieldsOf(doc);
  if (declared === undefined) return doc;

  let kept: Record<string, unknown> | undefined;
  for (const [name, def] of Object.entries(injectedSystemColumnDefs(doc))) {
    if (!isInjectedColumnDefinition(declared[name], def)) continue;
    kept ??= { ...declared };
    delete kept[name];
  }
  if (kept === undefined) return doc;

  return { ...(doc as unknown as Record<string, unknown>), fields: kept } as unknown as T;
}
