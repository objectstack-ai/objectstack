---
"@objectstack/plugin-sharing": minor
---

fix(plugin-sharing): hold `publicSharing.enabled` at redemption, not only at mint (#14033)

**BREAKING** runtime behaviour change on a published package: share links that
were legitimately minted can now stop resolving without anyone revoking them —
every link on an object whose `publicSharing.enabled` is not `true`. Shipped as
`minor` under the repo's launch-window convention (a breaking change does not
burn a major while the stack is in lockstep). No export is added, removed or
re-shaped; the level carries the breaking banner, not a surface change.

`ShareLinkService.createLink()` refused to mint on an object whose
`publicSharing` block was absent or had `enabled !== true` (422
`SHARING_NOT_ENABLED`), and nothing checked the switch again. `resolveToken()`
checked `revoked_at`, `expires_at`, the audience gates, the password, record
existence and — since #13608 — the block's `eligibility` predicate, then served
whatever survived, under the system context, to a caller with no principal at
all. So the platform held the block's CHILD predicate as a standing policy while
its PARENT switch governed minting only: an author who turned the whole feature
off stopped new links and not one existing link, and would have had to narrow
the predicate to stop anonymous serving — the opposite of what the surface
reads like. Measured before it was changed: a token minted while the block was
on kept serving the record in full after the block was turned off.

**What changed.** `resolveToken()` reads the object's CURRENT `publicSharing`
block on every redemption and refuses when `enabled` is not `true` — before the
record is read, before the usage stamp, before any sibling key inside the block
is evaluated. Re-enabling the block restores the same tokens: this is a standing
policy, not a revocation, and no `sys_share_link` row is touched. How a link was
minted buys it nothing at redemption — a link minted under a system context or
the service's `permissive` bypass (the system-context ledger's row 37 path) on a
switched-off object refuses exactly like one orphaned by an author turning the
block off, and an object with no `publicSharing` block at all is the same switch
at its default and refuses too. With the block on, `eligibility` (#13608) and
the declared `redactFields` (#13856) keep their existing redemption-time
behaviour; nothing new is evaluated.

**The refusal is deliberately indistinguishable.** It is the same answer a
revoked, expired, unknown or no-longer-eligible token already gets: the
undifferentiated `null` — no new error code, no new response branch, and no
usage stamp. Over HTTP a switched-off link is answered with the generic
`404 INVALID_OR_EXPIRED`, byte-for-byte what a token that never existed
receives. The readable reason (`SHARING_NOT_ENABLED`, with the link, object and
record ids) is written to the server-side log at `warn`, where the eligibility
refusal already writes its own.

**Operator impact — retroactive, on deploy.** Every live link on an object whose
`publicSharing` block is currently switched off — or that never declared one —
stops resolving the moment this version is deployed, with no revocation event
and no grace period. That is the intent: the alternative is a declared switch
the platform does not hold. Measure before rollout: the objects to read are
those whose `publicSharing.enabled` is not `true`, and the links at risk are the
`sys_share_link` rows naming them (`object_name`). To keep such links working,
enable the block — and narrow it with `eligibility` / `redactFields` if the
feature was off for a reason; there is no per-link opt-out, deliberately.
Minting is unchanged: `createLink` still refuses `SHARING_NOT_ENABLED` for an
ordinary caller, and the system / `permissive` bypass still mints — what it
mints simply does not serve until the block is on.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or re-shaped: `publicSharing.enabled` keeps its name, its type, its default and its accept-set, and the change is WHEN the platform holds it. There is therefore no tombstone for `objectstack migrate meta` to carry and no mechanical rewrite it could perform — a deployment whose links stop resolving must decide whether the block should be on at all, which is an authoring decision no ledger entry can make on its behalf. -->
