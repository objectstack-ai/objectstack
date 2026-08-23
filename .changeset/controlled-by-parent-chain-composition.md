---
"@objectstack/plugin-security": minor
---

fix(plugin-security): `controlled_by_parent` composes across a chain — a child whose master is itself derived is no longer readable and writable org-wide (#11082)

**BREAKING** access tightening, shipped as `minor` under the repo's
launch-window convention. It denies reads and writes that previously
succeeded — which is the whole point: they were never authorized by any
declaration, and the app author could not tell.

`controlled_by_parent` (ADR-0055) resolves a detail's access from its master.
#5386 made that resolution fold in the master's ownership and its
`sys_record_share` grants, not just the master's RLS policies. It did not
recurse, and both halves it composes answer "no restriction" for a master that
is **itself** `controlled_by_parent`:

- the RLS half is `null`, because a derived object authors no policy —
  declaring `controlled_by_parent` *is* its policy;
- the sharing half is `null` too: `plugin-sharing`'s `buildReadFilter` opts out
  of every model that is not `private`, and `effectiveSharingModel` maps
  `controlled_by_parent` to `public`.

Composed: `null`. The derivation's master query then ran as **system** with an
empty predicate and returned **every master row**, so a two-level chain was
enforced at level one and org-wide at level two. The write half failed through
a separate mechanism with the same result: the master gate asks `canEdit` on
the master row, `checkEdit` returns `abstain` for a `public`-mapped model, and
`abstain` is not `deny` — so it answered `true` for every master row.

Both halves now walk the chain. The read derivation composes the master's own
`controlled_by_parent` filter as a third layer, and the write gate runs its
three master-edit legs on each hop until it reaches a master that governs its
own rows. The master set is therefore point-for-point equal to what a direct
read of the master returns, at every level, which is the equality #5386
established for one level.

This is **not** a blanket refusal for chained declarations: a detail whose
whole chain is reachable stays readable and writable, and the single-level case
is unchanged. Two guards bound the walk and both fail **closed**, never to "no
restriction": a metadata cycle is refused, and so is a chain deeper than 8
links (a cost ceiling, not a supported-length statement — termination is
already guaranteed by the cycle guard).

What an app may observe: a detail under a `controlled_by_parent` master that
was reachable before is now reachable only if the caller can reach the whole
chain above it. Apps whose masters are `private`, `public_read` or
`public_read_write` — every `controlled_by_parent` object authored in this
repo — are unaffected.

<!-- adr-0087: not-required (no-migration-prescription) An access-derivation fix inside plugin-security. No spec surface is renamed, retired or re-shaped, no authorable metadata key changes meaning, and there is nothing for `objectstack migrate meta` to rewrite — a chained declaration that was silently unenforced is now enforced as it always read. -->
