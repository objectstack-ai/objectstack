---
"@objectstack/cli": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-audit": patch
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-messaging": patch
"@objectstack/service-realtime": patch
"@objectstack/service-storage": patch
---

chore(i18n): roll the generated-leaf provenance companion out to the remaining bundle sets (#12559)

`os i18n extract --source-hashes` (#11671, maintainer ruling #12069 Option A)
records, per generated translation leaf, the digest of the source revision that
leaf is **still a byte copy of** — the one signal that tells a stale fill from a
real translation once the source has moved and the two stopped being
distinguishable by value. It shipped opt-in, and exactly one of the nine i18n
bundle sets opted in. A landed detector, a changeset announcing it and a green
gate read together as *"generated translation staleness is now caught"*; for
eight of nine sets it was not, and the thing making it not caught was a single
absent flag in an extract config — invisible from all three of those surfaces.

**All eight remaining sets now opt in** — `plugin-approvals`, `plugin-audit`,
`plugin-security`, `plugin-sharing`, `plugin-webhooks`, `service-messaging`,
`service-realtime`, `service-storage`. Each documents `source-hashes` in its
extract config and commits three `<locale>.source-hashes.generated.ts`
companions, produced by the same extract run as the bundles they sit beside
(`check:i18n` compares them byte-for-byte, so they cannot be written by hand).
`check:i18n` now reports 7 bundles per set where it reported 4, and 11 for
`platform-objects` where it reported 8.

**Records count what is currently RECORDABLE, never what is covered.** A record
is written only for a leaf that *is* right now a byte copy of the current
source, so a fully translated locale starts with an empty table — which is the
instrument armed, not an instrument that measures nothing: the entry appears by
itself on the first extract after a leaf becomes a fill. Measured at this
commit, per set over its three translated locales: `service-messaging` 289,
`plugin-approvals` 61, `plugin-security` 33, `plugin-webhooks` 20,
`plugin-audit` 8, `service-storage` 7, `plugin-sharing` 1 (es-ES only; zh-CN and
ja-JP are fully translated and start empty), `service-realtime` 0 (all three
locales fully translated). **419 records written across the eight sets, 0
stale.**

**One extractor fix the rollout forced.** `--source-hashes` had one user, and
that user commits both generated sections, so the interaction with
`--no-metadata-forms` had never been exercised. The provenance table is computed
over every generated section the extractor builds; the eight sets here commit no
metadata-forms bundle, and their `metadataForms` subtree — absent from their
merge baseline — arrives as a fresh `--fill=default` copy of `en`, so every leaf
of it was recordable. First measured on `plugin-audit`: **763 records, of which
2 were its own objects and 761 were digests of the Studio metadata-form baseline
`@objectstack/platform-objects` owns.** Those records are unreadable in the
package holding them and would have rewritten all 24 companions on any unrelated
`*.form.ts` change in `packages/spec` — the cross-package coupling ADR-0029 D8
and every `bundle-ownership.test.ts` keep out of committed bundles. The
companion now covers exactly the sections a run commits, decided by the same two
predicates that decide the bundle files. `platform-objects` commits both, so its
three committed companions are byte-for-byte unchanged.

**Grade: `patch`, and behaviour on the day it lands is unchanged for every
leaf.** A record is written only where a leaf is currently a byte copy of the
**current** source, so every record written equals the current digest and none
of them can be stale; the mechanism cannot arrive red. No committed translation
bundle changed a byte, no public API moved, and no leaf's rendered text changed.
`narrowToCommittedSections` is new but internal to `@objectstack/cli` — the
package's entrypoint does not re-export the extractor utils.

**What this does not do**, stated so the boundary is not inferred wrongly a
second time: these eight sets now *record* provenance. Reading it at serving
time is `withSourceFallback`, and that is still wired in
`@objectstack/platform-objects` alone — so a stale fill in one of the eight is
now recorded and reportable, but not yet substituted at runtime. Tracked
separately.
