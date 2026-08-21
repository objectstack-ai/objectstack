---
"@objectstack/spec": minor
---

fix(spec): `theme` / `analytics_cube` are validated at the `/meta` write door (#10194)

The two doors #6245 left open, closed the same way. Both are declared,
authorable stack collections with real `.strict()` schemas —
`defineStack({ themes })` validates with `ThemeSchema`,
`defineStack({ analyticsCubes })` with `CubeSchema` — yet neither was bound in
`UNREGISTERED_KIND_SCHEMAS`, so `getMetadataTypeSchema()` answered `undefined`
and `saveMetaItem` took its documented "unregistered type → store without
validation" branch: a body the stack door strictly refuses was stored,
unvalidated and badged `success: true`, through the metadata door. For `theme`
that is the console's own styling surface — a malformed one failed at render
rather than at write, with nothing at the write point to say so.

**FROM** `PUT /meta/theme/:name` / `PUT /meta/analytics_cube/:name` with any
JSON → `200 { success: true }`, stored unvalidated.
**TO** a malformed body → `422 INVALID_METADATA` with structured `issues[]`,
the same envelope every other kind already returned. A well-formed body is
accepted exactly as before.

Each entry binds the **same schema its stack collection is validated against**
(`ThemeSchema` at `stack.zod.ts` `themes:`, `CubeSchema` at `analyticsCubes:`),
and that closing invariant is now pinned by identity for all five map entries.

**No new capability surface.** Shape validation only: no `MetadataTypeSchema`
member, no `DEFAULT_METADATA_TYPE_REGISTRY` entry, so every authorization
verdict keeps taking the identical "no static entry ⇒ synthesised
`allowRuntimeCreate: true`" branch. The write *door* is unchanged; only the
422 is new. #2657's B/C decision on whether these should become kinds is
untouched and unprejudged. `rag_pipeline` is deliberately not bound — it has
no stack collection to take a schema from (#6242 row 2).

Graded **minor**, following #6245's landed precedent for the identical change
(itself following #5271): a write that previously returned 200 can now return
422. Nothing well-formed changes behaviour, but a caller relying on the API
accepting malformed bodies will see the difference.

**One schema change rides along per kind, and it is load-bearing.**
`Theme` and `Cube` now declare the ADR-0010 protection envelope (`_lock`,
`_lockReason`, `_lockSource`, `_lockDocsUrl`, `_packageId`, `_packageVersion`,
`_provenance`) — the sharing_rule precedent from #6245: both metadata load
paths call `applyProtection` on **every** type, and these shapes are
`.strict()`, so binding the door without the spread would have aimed the new
422 at the runtime's own stamp instead of at malformed author input. Additive
and internal-only — no authored field changes.
