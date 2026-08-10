---
"@objectstack/plugin-security": patch
"@objectstack/spec": patch
---

fix(plugin-security): `checkAuthoredRowWrite` answers the declaration, not the caller's read scope (#7281)

`ISecurityService.checkAuthoredRowWrite` asks one question — *does an
app-authored row-level widener admit this row for this write?* — and it resolved
that question by re-reading the row through the **caller's own** execution
context. That `findOne` re-enters the middleware chain, so `plugin-sharing`'s
READ filter applied: on a `private`-OWD object a cross-owner row is invisible to
the caller, the read answered null, and the verdict was `abstain` for a row the
declaration names by predicate.

Measured on the real stack across two objects identical in every respect except
their OWD — same widener text, same principal, same cross-owner row shape:

| OWD | verdict before | verdict after |
|---|---|---|
| `public_read` | `admit` | `admit` |
| `private` | **`abstain`** | **`admit`** |

So the by-id widener surface was live on read-open objects and stood down on
read-closed ones, discriminated by a property the widener's author never
mentions — and `private` is the posture #5493 built that surface for. The
maintainer ruled it a defect (2026-08-10): the verdict is about the row and the
policy, not about what the caller may see. The probe read now resolves under an
elevated, principal-less scope.

**This does not widen anything.** The predicate carries the whole of the
question and travels in the query rather than in the scope: `{id} AND
layer0(tenant wall) AND layer1(app-authored policies)`, both layers still
compiled from the caller's own permission sets and tenant before the read, and
the read is projected to `id` so the probe can only ever learn *that* a row
matches. A row in another tenant, a row no authored policy matches, and a caller
holding no authored policy at all all still answer `abstain` — pinned, including
by mutation: delete the tenant layer from the predicate and the cross-tenant case
goes red. `admit` also remains evidence and never authorization: the by-id write
pre-image gate still resolves the write under the caller's own context and
refuses on its own terms.

One consequence is stated plainly rather than papered over: because that
pre-image gate performs the same caller-scoped read, a `private`-OWD cross-owner
by-id write is **still refused end-to-end** after this change — now by the
row-level gate (`PERMISSION_DENIED`, "…(row-level security)") rather than by the
sharing middleware's `FORBIDDEN`. Whether a write should reach a row the caller
cannot read is a separate contract question about that gate's read scope, and it
is not settled here. Both behaviours are pinned on the real stack.

The `@objectstack/spec` half is documentation only: `ISecurityService`'s contract
listed "the row is unreadable" among the `abstain` cases, which is exactly the
conflation the ruling removed. No signature, shape or vocabulary changes, and the
method stays optional and fail-closed.
