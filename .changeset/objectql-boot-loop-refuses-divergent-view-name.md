---
"@objectstack/objectql": minor
---

fix(objectql): the boot loop refuses a view container whose `name` disagrees with the object it binds to, instead of silently rewriting the author's field (#14666)

**BREAKING** accept-set narrowing on the ObjectQL boot loop's SOURCE registrar
(`registerMetadataCollections`), shipped as `minor` under the repo's
launch-window convention for breaking changes. Ruled on #14666 (2026-09-03,
direction 2).

An aggregated `defineView` container is keyed by the OBJECT it binds to, not
by its own row identity, and `ViewSchema` declares an optional `name` whose
own description says that for an object-scoped container it *is* the object
name. Nothing enforced that. A container written as
`{ name: 'lead_views', object: 'crm_lead', list: { ... } }` therefore reached
the two SOURCE registrars and got opposite answers: this boot loop overwrote
`name` with the derived key `crm_lead` and registered it, discarding the
author's field with no diagnostic, while the artifact/HMR loader
(`MetadataPlugin._parseAndRegisterArtifact`) refused the whole artifact load
through `assertMetadataRegisterContract` (#7378 row 1, `VALIDATION_ERROR` /
400). Same document, and whether it loaded at all depended on how the package
was loaded.

The boot loop now **refuses loudly**, with the same `VALIDATION_ERROR` / 400
envelope the artifact door raises, naming the container's own `name`, the
object key it derived, and both remedies: drop `name`, or set it to that
derived key. #7378 row 1 already ruled that resolving such a disagreement
silently, in either direction, files the item under a key the caller never
wrote, so the two registrars converge on the refusal rather than on the
rewrite; the artifact door is unchanged.

**Refused shape**, precisely: an aggregated view container in a stack `views:`
collection that carries a non-empty top-level `name` AND derives a different
object key from its own `object` (or, failing that, `list.data.object` /
`form.data.object`).

Scope, which the ruling names as this change's main risk. A container with no
`name` is untouched, and still registers under its derived key. So is a
container whose `name` already equals that key, and one that declares no
binding anywhere else, since the derivation then falls back to that same
`name` and cannot disagree with itself. No other metadata kind changes
behaviour: the refusal is gated inside the `views` branch of the generic
registration loop. Standalone ViewItems and flattened overlays travelling in
the assembled `viewItems:` channel are untouched, because a container cannot
reach that channel at all. Every one of these has a control test.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over an existing optional key: `ViewSchema.name` is neither removed, renamed nor re-shaped, and forbidding it on object-scoped containers in spec was the direction the ruling explicitly refused, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. Which of the three repairs an affected container wants is authoring intent no migration entry can decide: the author may have meant the container name to go, may have meant it to become the object key, or may have mistyped `object` and want THAT corrected instead, and the stored document carries no evidence of which. The refusal is the channel that reaches the author, at the registration site, naming both values and both remedies. Measured in-repo population of affected sources is zero: no `views:` collection reaching this seam carries a divergent container `name` (the three engine-booting fixtures with inline containers are in `packages/objectql`, and the example apps' `.view.ts` containers declare no top-level `name` at all). -->
