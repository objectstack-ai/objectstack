---
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(objectql,metadata-protocol): deleting a runtime-created overlay retires its registry entry, so list/get/dispatch agree (#5079)

Deleting a metadata item an admin had **created** at runtime (`DELETE
/api/v1/meta/<type>/<name>` for a name no code package ships) removed the
`sys_metadata` row and reported `reset: true`, while every read surface kept
serving the deleted item for the life of the process: `GET /meta/<type>` still
enumerated it, `GET /meta/<type>/<name>` still returned its body, and the
ADR-0110 D3 declaration gate still resolved a declaration for it. No TTL was
involved — only a restart cleared it. This is the residual branch of #4432
("every surface in agreement"), the mirror image of the write direction #4521
fixed.

**Cause.** #4521 made `saveMetaItem` write an overlay through into the engine's
`SchemaRegistry` under the PLAIN key, so a saved item is dispatchable and not
merely listable. The delete side's registry heal
(`restoreArtifactRegistryView`) only knew how to *un-shadow a packaged
artifact*: `SchemaRegistry.removeRuntimeShadow` deletes the plain key **only**
when a composite `<packageId>:<name>` artifact remains underneath, so that the
name stays resolvable. For a runtime-created item there is no artifact —
the row *was* the item — so the heal declined and nothing else ever removed the
entry.

**Fix — at the producer, not the readers.** `restoreArtifactRegistryView` now
walks the layers under the deleted overlay and stops at the first one that can
serve the name: (1) a composite-key artifact, (2) a MetadataService baseline,
and (3) — new — nothing, in which case the plain-key entry is retired via the
new `SchemaRegistry.removeOverlayEntry(type, name)`. The registry now makes the
same distinction the delete receipt already makes (#5927): "reset to artifact
default" vs "it no longer exists".

Two boundaries are preserved deliberately:

- **A packaged artifact is never unregistered.** `removeOverlayEntry` refuses a
  plain-key entry that is itself an artifact (`_packageId` set, not the
  `sys_metadata` rehydration sentinel, not tenant-authored) — the same
  predicate `getArtifactItem` applies to its own bare-key fallback — and never
  touches composite keys. Resetting a customization of a shipped item still
  reveals the shipped value.
- **An outage is not an absence (ADR-0110 D3).** The layer-2 baseline read now
  decides whether an entry is retired, so it goes through the diagnosed read: a
  metadata plane that could not answer stops the walk instead of retiring an
  entry on the strength of a read that never happened.

Measured on the showcase app: before, `POST /api/v1/actions/<object>/<name>`
after the delete answered 404 with the *handler-miss* wording ("… not found"),
because the declaration was still resolvable from the stale entry; it now
answers the ADR-0110 "has no declaration" 404 — byte-identical to the state
before the item was ever created.
