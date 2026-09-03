---
"@objectstack/plugin-sharing": minor
"@objectstack/runtime": minor
---

fix(sharing): gate the share-link route probe on `publicSharing.enabled`, at both probe sites (#14637)

**BREAKING** runtime behaviour change on a published HTTP path:
`GET /api/v1/share-links/:token/resolve` answers `404 INVALID_OR_EXPIRED` where
it used to answer `401 NEEDS_PASSWORD` / `401 WRONG_PASSWORD` /
`401 SIGN_IN_REQUIRED` / `410 EXPIRED_OR_REVOKED`, for every link whose object
has `publicSharing.enabled` switched off. Shipped as `minor` under the repo's
launch-window convention (a breaking change does not burn a major while the
stack is in lockstep). No published export is added, removed or re-shaped; the
level carries the breaking banner, not a surface change.

#14033 made `publicSharing.enabled` a standing policy: `resolveToken()` re-reads
the object's current block on every redemption and refuses a switched-off link
with the same undifferentiated `null` a revoked, expired, unknown or ineligible
token gets — because, in that gate's own words, for a caller who may hold
nothing but a token a distinguishable "sharing is off for this object" is an
**existence oracle**.

The HTTP layer above it then re-opened exactly that oracle. Both share-link
surfaces run a row probe after `resolveToken()` returns null, to answer with a
more useful status, and both answered from the `sys_share_link` row with no
knowledge of the object's block. So an anonymous caller could still tell a
real-but-switched-off token from an unknown one three ways: a row carrying
`password_hash` drew `401 NEEDS_PASSWORD`, the same row with any password drew
`401 WRONG_PASSWORD` — including a **correct** password, which is both an oracle
and a lie, since that link can serve nothing — and a row with
`audience: 'signed_in'` drew `401 SIGN_IN_REQUIRED`. A security property stated
in one layer and defeated in the layer above it is worse than one never claimed,
because the next reader believes the comment.

**What changed.** Both probes read the object's standing policy before they
answer from the row, and when the block is off every arm falls through to the
generic `404 INVALID_OR_EXPIRED` that unknown, revoked, expired and ineligible
tokens already give — byte-for-byte the answer a token that never existed
receives. The `410 EXPIRED_OR_REVOKED` arm is included: gating only the two 401
arms would leave a third class of link answer and a rule about which arms are
gated. An object whose schema the engine cannot answer for is `enabled: false`
by `getPolicy`'s definition and is refused the same way — fail-closed, the same
definition `createLink` and `resolveToken` already use.

The fix lands at **both** sites in one change, because the probe exists twice:
`plugin-sharing`'s REST routes, and the `/share-links` dispatcher domain in
`@objectstack/runtime` that is the designed primary surface for cloud's
per-environment kernels (`registerShareLinkRoutes: false`). Fixing one would
have moved the oracle to whichever embedding uses the other.

**Nothing else moves.** With the block ON, every refusal is exactly what it was:
`NEEDS_PASSWORD`, `WRONG_PASSWORD`, `SIGN_IN_REQUIRED` and `EXPIRED_OR_REVOKED`
are unchanged in status, code and message, and a correct password or a signed-in
viewer still resolves the record. Mint-time behaviour is untouched, no
`sys_share_link` row is written or read differently, and no error code is added
or retired.

**Consumer impact.** A viewer that branches on the refusal STATUS sees TWO
changes, for links on a switched-off object only — and the measured consumer
branches on status alone. On the objectui console at `67dadd6`,
`apps/console/src/pages/SharedRecordPage.tsx` lines 70-85 dispatch on
`res.status` and never on the body's error code, so:

- all three 401 arms (`NEEDS_PASSWORD`, `WRONG_PASSWORD`, `SIGN_IN_REQUIRED`)
  rendered the password prompt and now render the 404 copy, "This link is
  invalid or no longer available.";
- the 410 arm rendered "This link has expired or was revoked." and now renders
  that same 404 copy.

Both shifts are the intended outcome and were accepted with the ruling: a
correct password on such a link yields nothing, so prompting for one teaches the
holder to open a door that is bricked up, and "expired or revoked" is a claim
about a token whose existence the caller must not be able to confirm. Links on
objects whose block is on are unaffected — prompt, 410 copy and 200 render
included.

Maintainer ruling 2026-09-03 (decision batch #17, item 1), verbatim 「同意」,
adopting option A over option B (keep the 401 and document the accepted oracle)
and option C (gate only the two 401 arms, rejected as proliferation).

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or re-shaped: `publicSharing.enabled` keeps its name, type, default and accept-set, and this change is only WHICH HTTP STATUS the route layer answers with while that switch is off. There is no tombstone for `objectstack migrate meta` to carry and no mechanical rewrite it could perform on any consumer — a deployment that wants the 401 affordance back enables the object's block, which is an authoring decision, not a migration. -->
