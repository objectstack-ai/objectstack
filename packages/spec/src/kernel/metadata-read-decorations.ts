// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Read-time metadata decorations
 *
 * Keys the metadata READ path stamps onto a served document. Each is DERIVED
 * from the document on every read, so it belongs to the *response*, never to
 * the document — a served body is therefore NOT a valid input to the schema
 * that produced it until these are removed.
 *
 * Two classes of consumer must strip them, for the same underlying reason:
 *
 *  1. **The write path.** `saveMetaItem` persists the request body verbatim by
 *     design (ADR-0005 §Validation), so the standard Studio GET → edit → PUT
 *     round-trip used to bake a read-time verdict into `sys_metadata.metadata`,
 *     into its checksum, and into every history diff (#4326).
 *  2. **Any re-parse of a served document.** Since protocol 17 (#4001) the
 *     metadata schemas are CLOSED — `FlowSchema.parse()` rejects unrecognized
 *     keys instead of dropping them — so handing a served body back to its own
 *     schema fails on our own annotation. That is what killed the cold-boot
 *     flow bind (cloud#971): `getMetaItems({ type: 'flow' })` → `registerFlow`
 *     threw `unrecognized_keys: ["_diagnostics"]` for EVERY flow, and only a
 *     second binding path (the record-change plugin) kept automations firing.
 *
 * The list lives in `spec` rather than in the protocol implementation because
 * the producer (`@objectstack/metadata-protocol`) and the consumers
 * (`@objectstack/service-automation`'s flow bind, …) sit in different layers
 * and must not drift: a decoration added to the read path but not to this list
 * is a key no consumer knows to remove, and — post-#4001 — every strict
 * re-parse of that document starts throwing.
 *
 * Current members:
 *  - `_diagnostics` — the spec-validation verdict `decorateMetadataItem`
 *    spreads onto every `getMetaItem`/`getMetaItems` result. A second producer
 *    stamps the same key: view-container expansion records a name-collision
 *    rename warning (`stampRenameWarning`, `spec/ui/view.zod.ts`). Both are
 *    derived from the document, so neither belongs inside it.
 *  - `_draft` — the preview badge added by draft reads. Draft-ness lives in the
 *    row's `state` column and the `mode` parameter, never in the body.
 *
 * Deliberately NOT members, though they share the underscore spelling: the
 * ADR-0010 protection envelope (`_lock`, `_lockReason`, `_lockSource`,
 * `_provenance`, `_packageId`, `_packageVersion`, `_lockDocsUrl` — see
 * `MetadataProtectionFields`). Those are envelope state the write path
 * legitimately carries and merges, and the closed metadata schemas allowlist
 * them precisely so a served document keeps its provenance on re-parse.
 */
export const METADATA_READ_DECORATIONS = ['_diagnostics', '_draft'] as const;

/** Union of the keys in {@link METADATA_READ_DECORATIONS}. */
export type MetadataReadDecoration = (typeof METADATA_READ_DECORATIONS)[number];

/**
 * Remove {@link METADATA_READ_DECORATIONS} from a served metadata document,
 * so it can be persisted or re-parsed as if it had never been served.
 *
 * A **silent** strip, unlike the layered-envelope rejection in `saveMetaItem`:
 * that envelope is a wrong document the caller must fix, whereas these keys are
 * our own decoration riding along on a document that is otherwise exactly what
 * the author edited. Rejecting the standard GET → edit → PUT round-trip would
 * be hostile; stripping restores the invariant that a round-trip persists the
 * body byte-identical.
 *
 * Returns the SAME reference when there is nothing to strip, so the common path
 * allocates nothing. Non-object inputs pass through — the caller's own
 * validation owns those.
 */
export function stripReadDecorations(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const dict = item as Record<string, unknown>;
  if (!METADATA_READ_DECORATIONS.some((k) => k in dict)) return item;
  const next = { ...dict };
  for (const k of METADATA_READ_DECORATIONS) delete next[k];
  return next;
}
