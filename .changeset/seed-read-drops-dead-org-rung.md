---
"@objectstack/runtime": patch
---

The package-publish seed read-back no longer runs a two-attempt org-then-env ladder whose rungs resolve the same row.

`applyPublishedSeeds` — the route-level seed apply behind `POST /packages/:id/publish-drafts`, which runs for protocols that do not self-apply seeds inside `publishPackageDrafts` — read each just-published `seed` body twice when the session had an active organization: once naming the organization, then once env-wide. The comment above it said the first attempt tried the active org and the second fell back, "and resolving the wrong scope here is what silently produced `0 rows loaded`".

That was true when it was written and is not true now. `seed` declares `allowOrgOverride: false`, and `getMetaItem` resolves `organizationIdForMetaRead(request.type, request.organizationId)` once at its top and spends that binding — never the raw argument — on every read beneath it. The predicate answers `undefined` for every non-overridable type, so both rungs asked the engine the same predicates and served the same answer. Measured rather than reasoned: against the shipping protocol over one store, the two requests produce byte-identical engine reads and byte-identical answers on both the hit and the miss branch, and neutering the second rung reddens nothing on a pinned publish-then-read path (a `view` control confirms the same comparison does separate the two rungs for an org-overridable type).

The read is now a single call naming no organization, and the comment states that the scope is decided by the registry flag and the gate inside `getMetaItem` rather than by this call site — matching the sentence the `app` flip in the same file already carries.

One observable changes, and only on the failure branch: `getMetaItem` answers a wrapper rather than a falsy value for a name it cannot resolve, so the second rung was in practice reached only when the read *threw* — where it repeated the identical failing read and appended the same sentence to the client-facing `seedApplied.errors[]` twice. A failed read-back is now reported once. Nothing about which row a publish resolves, or whether its rows load, moves.
