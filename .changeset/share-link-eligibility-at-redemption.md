---
"@objectstack/plugin-sharing": minor
"@objectstack/spec": minor
---

fix(plugin-sharing,spec): hold `publicSharing.eligibility` at redemption, not only at mint (#13608)

**BREAKING** runtime behaviour change on a published package: share links that
were legitimately minted can now stop resolving without anyone revoking them.
Shipped as `minor` under the repo's launch-window convention.

`ShareLinkService.createLink()` evaluated the object's declared
`publicSharing.eligibility` predicate before writing a `sys_share_link` row, and
nothing evaluated it again. `resolveToken()` checked `revoked_at`, `expires_at`,
the audience gates, the password and record EXISTENCE — then served whatever
survived, under the system context, to a caller with no principal at all. So the
declaration read as a standing policy about which records may be reached
anonymously, while the platform held it at exactly one instant in a link's life.

The state the predicate reads is the state an editor changes. Publish an article
`published` + `public`, mint a link, then flip `audience` to `internal` or
`status` back to `draft`: the object's own policy now says the record is not
eligible for link sharing, and the old token kept resolving and kept serving the
record in full. The remedy was to revoke every link on the record by hand, which
first requires knowing they exist.

It also sat oddly beside its neighbour. In that same `resolveToken()`, the
record-existence probe is deliberately fail-CLOSED (an unanswered probe denies),
so a **deleted** record stopped being served immediately while a
**reclassified** one did not — two failure directions in one door.

**What changed.** `resolveToken()` re-evaluates the predicate against the record
it is about to serve, through the same `assertEligible` the mint path calls, so
the two points cannot drift on strictness, on the declared-field binding, or on
which faults refuse. It is one read either way: when a predicate is declared the
existence probe's projection widens from `['id']` to the whole row instead of a
second query being issued, so an object with no `eligibility` key keeps the
exact probe it always had. Fail-closed, matching mint: a predicate that will not
compile, faults on the record, or answers anything other than `true` refuses.

**The refusal is deliberately indistinguishable.** For a caller who may hold
nothing but a token, telling "does not exist" apart from "revoked" apart from
"no longer eligible" is an existence oracle, so the redemption refusal is the
same undifferentiated `null` a revoked, expired or unknown token already gets —
no new error code, no new response branch, and no usage stamp. Over HTTP an
ineligible link is answered with the generic `404 INVALID_OR_EXPIRED`, byte-for-
byte what a token that never existed receives. The readable reason a link died
is written to the server-side log instead.

**Operator impact.** Deployments upgrading across this change can feel it
immediately: any live link whose record has since moved out of its object's
`eligibility` predicate stops resolving, with no revocation event and no grace
period. That is the intent — the alternative is a declared policy the platform
does not hold — but it is worth measuring before rollout: an object's
`eligibility` predicate is the thing to read, and the links at risk are those on
records that no longer satisfy it. An operator who needs such links to keep
working must widen the predicate; there is no per-link opt-out, deliberately.
`redactFields` behaviour, the audience/password gates and objects that declare
no `eligibility` key are all untouched and pinned.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or re-shaped: `publicSharing.eligibility` keeps its name, its type and its accept-set, and the change is WHEN the platform evaluates it. There is therefore no tombstone for `objectstack migrate meta` to carry and no mechanical rewrite it could perform — a deployment whose links stop resolving must decide whether its own predicate is still the policy it wants, which is an authoring decision no ledger entry can make on its behalf. -->
