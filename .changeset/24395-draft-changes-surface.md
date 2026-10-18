---
"@objectstack/spec": minor
---

feat(spec): a metadata save declares its authoring surface — `SaveMetaItemRequestSchema.surface`, in one exported closed set shared with `draftChanges[].by`

Clause-②: yes (widening)

- **One closed set, one name.** `MetadataAuthoringSurfaceSchema` (`copilot | studio | api`) is exported from `@objectstack/spec/api`, with its type `MetadataAuthoringSurface`. `GetMetaItemResponseSchema.draftChanges[].by` now reads it instead of an inline enum: the accepted values are unchanged.
- **The save states its surface.** `SaveMetaItemRequestSchema` gains an optional `surface` from that set. A draft save stamps it as `by` on each key path it changes; an absent `surface` stamps `api`. On the REST door and the runtime dispatcher it is the `?surface=` query parameter, which takes `studio` or `api` only: `copilot` is stated by an in-process AI tool, never over HTTP.
- **The writer exists.** The `draftChanges` describe no longer says no server writes it: it states the writer's rules (the first draft save is compared with the stored published row, an item with no stored published row is recorded as `[]`, and a `migrate-stored` rewrite records nothing).
