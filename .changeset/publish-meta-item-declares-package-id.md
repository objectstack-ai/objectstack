---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
---

Declare `packageId` on `publishMetaItem`'s request type, and correct three
in-tree comments that claimed the per-item publish door "names no package"
(#10350).

`publishMetaItem` declared `type / name / organizationId / actor / message /
_skipSeedApply` and no `packageId`, while since #10063 `POST
/meta/:type/:name/publish?package=PKG_ID` states one on every HTTP-driven
promotion that names a package — which is Studio's designer save-then-publish
loop.

**No runtime behaviour changes, and nothing was broken at runtime.** The value
already flowed end to end: `publishMetaItem` forwards its whole request object,
the one transform in between (`canonicalizeMetaRequestType`) is a spread that
drops no key, and `promoteDraftForPublish` already declared
`packageId?: string | null` and threaded it into both the #9612 gate closure and
`repo.promoteDraft`. What was wrong was the *declared* contract: the binding was
invisible to every typed caller, and the only caller that states one reaches the
method through a cast, so it was enforced by nothing — one destructuring
refactor away from being dropped in silence.

`packageId` is `string | null | undefined`, and the three states are distinct:
an **absent** key keeps the historical "match any package" resolution, `null`
pins the lookup to the unbound row, and a present-and-`undefined` key coerces to
`null` downstream and makes a package-bound draft unfindable. Spread it in
conditionally; never write `packageId: maybeUndefined`.

`environmentId` is deliberately **not** added, though it sits in the same
cast-hidden position on the REST call site. It is the multi-kernel routing key
and is out of the protocol request shape by the maintainer ruling recorded
2026-08-18 on #9741 — `resolveProtocol(environmentId)` selects the kernel before
the call, and `request.environmentId` is read nowhere in
`@objectstack/metadata-protocol`. `packages/rest` types that one transport-level
member on top of the declared shape (`TransportScopedMetaRequest`) instead.

Three pins land in `protocol-publish-drafts-package-scope.test.ts`, on the same
two-colliding-drafts fixture the #8907 batch-door cases use, so a promote that
loses the package dimension resolves the *wrong* row rather than merely
succeeding.
