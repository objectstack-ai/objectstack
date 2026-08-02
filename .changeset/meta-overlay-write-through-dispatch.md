---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a just-saved overlay is dispatchable immediately, not after the next listing (#4521)

The #4432 F1 verification found that immediately after a successful
`PUT /api/v1/meta/action/<name>`, `GET /api/v1/meta/action` already listed the
overlay while `POST /api/v1/actions/<object>/<name>` answered the ADR-0110
"has no declaration" 404 — and a later POST succeeded. Nothing expired in
between: the *listing* is what repaired it.

The lagging cache was the engine's `SchemaRegistry`. The runtime dispatch path
(`resolveRouteActionDeclaration`) reads it as the live view of metadata, but
`saveMetaItem` only wrote through it for `object` — every other overlay type
reached the registry solely via the READ-side hydration in `getMetaItems`, so
"has anyone listed this type yet?" silently decided whether a saved action
could be invoked.

The fix is at the producer, per Prime Directive #12 — no retry, sleep, or
fallback was added at the dispatch site:

- `saveMetaItem` (publish mode), draft publishing (`runPublishSideEffects`),
  and `rollbackMetaItem` now write EVERY overlay type through the registry via
  a shared `applyRegistryWriteThrough`, so an item that is listable is
  dispatchable in the same breath.
- The write-through and the read-side hydration share one implementation
  (`hydrateOverlayIntoRegistry`), including the ADR-0010 §3.3 protection-envelope
  graft and the ADR-0048 package-scoped artifact lookup — a read and a write
  can no longer leave the registry in two different states for the same row.
- Unchanged boundaries: drafts still never leak into the live registry, the
  `environmentId` scoping gate matches the read side, ADR-0110's 404 for a
  genuinely absent declaration stands, and DELETE ("reset to artifact default")
  still restores the packaged artifact — the overlay is a plain-key shadow, not
  an in-place overwrite.
