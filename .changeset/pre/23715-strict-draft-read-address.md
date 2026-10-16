---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
---

fix(metadata-protocol): the strict draft read naming no package (`GET /api/v1/meta/TYPE/NAME?state=draft`) serves its content from the draft its `version` names, the draft the draft save, the per-item publish and the draft discard naming no package act on (ADR-0048, ADR-0070)

Clause-②: yes

A `sys_metadata` row is keyed by its package (ADR-0048), so an item never published into a package can hold a package-unbound draft beside package `Q`'s. The strict draft read naming no package answered its `version` from the package-unbound draft (the draft the save naming no package writes), but its content from whichever draft row the store returned first. On a store that returned `Q`'s row first, it served `Q`'s body under the package-unbound draft's token, and a save pinned to that token (`If-Match`) wrote the package-unbound draft, a different row from the one read.

The read now takes its content from the same address as its `version`, in every storage order: the package-unbound draft when one is stored, else the one package's draft; for an item whose active rows are bound to one package, that package's draft as before. The draft-overlay preview naming no package (`previewDrafts`) serves the same draft. Drafts bound to two or more packages with no package-unbound draft are still served best-effort, with `version: null`, as before (the save naming no package is refused there). No accept set changes: no request that was answered `200` is refused now, and `?package=` still reaches each package's draft.

`@objectstack/spec`: the description of `PublishMetaItemRequestSchema.packageId` now says, as `SaveMetaItemRequestSchema.packageId`'s does, that a publish naming no package is refused for drafts bound to two or more packages only when no package-unbound draft is stored. Description only.
