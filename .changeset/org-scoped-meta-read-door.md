---
"@objectstack/metadata-core": patch
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
---

fix(rest): org-overridable metadata is served back by every `/meta` read door, not just persisted (#9454)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is
added, renamed, retired or tombstoned. One new exported predicate in
`metadata-core` (`organizationIdForMetaRead`), one widened optional request
member on an existing protocol method (`getMetaItemCached`'s `organizationId`),
and caller-side threading in `packages/rest`. The accept/reject behaviour of
every write door is unchanged — this card is read-side only. -->

A runtime `PUT` of an org-overridable metadata type — `view`, `dashboard`,
`report`, `translation`, `email_template` — answered **200** with a receipt
reporting `state: 'active'` plus a version and sequence number, **persisted the
row with its `organization_id`**, and was then served back by **nothing**: the
direct `GET` answered 404, the scoped listing was unchanged, the unfiltered
listing was missing it, and the browser rendered an empty view or "Dashboard Not
Found". The platform reported success in the same breath as not delivering the
work, which is declared ≠ enforced in the direction hardest for an author to
notice — the write path says everything worked.

**The write door was correct as-is.** The row really is persisted, so the
receipt is truthful; this was persisted-but-not-served, never a silent write
no-op. **The overlay-resolution layer was correct too**, and type-agnostic:
`getMetaItem` resolves `(orgId ? findOverlay(orgId) : undefined) ??
findOverlay(null)`, `getMetaItems` unions both scopes under org-wins precedence,
and `getMetaItemLayered` even reports `overlayScope`. The defect was that the
REST read doors **never stated the scope**, so every one of them asked for the
env-wide partition and the org partition was never consulted.

**The repair is one registry-derived predicate, threaded at the read doors.**
`organizationIdForMetaRead` joins `organizationIdForMetaWrite` in
`metadata-core`, deriving from the same `allowOrgOverride` registry flag, so
read scope and write scope cannot drift and a registry entry flipping the flag
moves both doors together. It is threaded through the **already-memoised**
`resolveExecCtx`, so no new per-request organization resolution is introduced.

⛔ **Not a bare `ctx?.tenantId` at each site**, and the reason is measurable
rather than stylistic: deployments predating the #6190 ruling hold **phantom
org-scoped rows for types the registry declares non-overridable** (the runtime
used to stamp `organization_id` on every type). Boot hydration deliberately
walks past those rows, so they are dead. A read door naming the org for *every*
type would resolve them again — serving, on the read side, a document that
vanishes at the next restart.

**`getMetaItemCached` gains an `organizationId` member** — it was the only meta
read verb that could not express one, having hard-coded a two-key delegation to
`getMetaItem`. The organization is also folded into its **ETag**. The mechanism
differs from `locale` and the difference is stated rather than glossed: `locale`
is invisible to the hash (the body is translated after the validator runs), so
folding it in was the only way it could vary the validator at all, whereas the
org-resolved document *is* the thing hashed. No cache leak is claimed — the
directive is `private, no-cache` and there is no server-side cache entry keyed by
type+name. It is folded in because that makes scope a **declared** property of
the validator instead of an emergent property of the body.

**Both REST branches are fixed, which is the half-fix this card could easily
have shipped instead.** `view` and `dashboard` share one mechanism but reach it
through two different arms: `view` takes the cached arm (`getMetaItemCached`),
while `dashboard` bypasses the cache via `isDashboardType` and takes the
uncached arm. Both omitted the org, so a fix applied to one arm would have
fixed exactly one type while the receipt kept claiming success for the other.
The scope is now resolved **above** the fork, so the two arms cannot disagree.

The regression proof drives real REST routes against a real protocol over a stub
engine — write-then-read agreement on **one boot**, for all five types, through
both arms. Its most important assertions are the ones that do **not** merely
check the item comes back: an org-less caller and a **second organization** must
each be refused it. An org-blind overlay fallback would satisfy every other
assertion in the file while matching an arbitrary tenant's row.
