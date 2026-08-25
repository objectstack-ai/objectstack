---
"@objectstack/spec": minor
---

feat(spec): enforce the documented `newTabUrl` / `opensInNewTab` co-constraint on `ActionSchema` (#11842)

**BREAKING** accept-set narrowing on `ActionSchema`, shipped as `minor` under
the repo's launch-window convention for breaking changes.

`newTabUrl`'s doc has always said "Only valid together with `opensInNewTab`",
and every renderer read point agrees: objectui's pre-opened-tab wrapper reads
the key only behind `action.opensInNewTab && newTabUrl`, and no other path
reads it at all. Nothing on the refine chain enforced the pairing, so an
action declaring `newTabUrl` without `opensInNewTab: true` parsed clean and
the key was silently inert — the ADR-0078 declared-but-unenforced shape,
arriving through a documented co-constraint rather than a missing key.

`ActionSchema` now **rejects at parse time** an action declaring `newTabUrl`
whose `opensInNewTab` is not `true`, with guidance naming the pre-opened-tab
contract and both remedies (declare the flag if a pre-opened tab is intended;
otherwise delete the inert key — behavior is unchanged either way it was
already behaving, because the lone key was never read). An explicit
`opensInNewTab: false` beside `newTabUrl` is refused too, deliberately:
unlike the #11519 doubled-channel rule, `newTabUrl` has no meaning outside
the pre-opened-tab flow, so a declared-off channel leaves the key exactly as
dead as an undeclared one.

The legal pairing is untouched and pinned byte-identically: `opensInNewTab:
true` + `newTabUrl`, `opensInNewTab` alone, and `opensInNewTab: false` alone
all parse exactly as before. The corpus was measured at zero lone-`newTabUrl`
producers (this repo's examples and platform metadata, objectui's fixtures
and renderer read points, and the cloud SSO producers, which declare the pair
correctly — re-measured at claim per the triage requirement), so no shipped
metadata is affected.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over a pair of existing keys: no key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The refusal is the channel that reaches an affected author, at the parse site, carrying both remedies; whether a lone `newTabUrl` meant "add the flag" or "delete the leftover" is authoring intent no migration entry can decide on an upgrader's behalf — and the measured population of affected sources is zero in every corpus. Mirrors the disposition of the adjacent #11519 narrowing on the same schema. -->
