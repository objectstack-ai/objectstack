---
"@objectstack/platform-objects": minor
"@objectstack/cli": minor
---

feat(platform-objects,cli): record which source revision a generated translation leaf was filled from (#11671)

Closes the half of the sticky-translation-drift class that no value comparison
could reach, under maintainer ruling #12069 Option A — by extending the existing
#8765 Option B source-hash mechanism to the generated bundles rather than
building a second one.

**The hole.** `os i18n extract --fill=default` fills gaps only: any non-empty
value in a translated locale wins forever. So the ordinary sequence — extract,
revise the source string, extract again — rewrites `en` and strands the previous
source text in every other locale. The bundle is still in sync by key, so
`check:i18n` reports OK; the leaf is still present, so `check:i18n-coverage`
counts it translated. Measured on #11659 at `bbe0b17`: three locales serving a
602-char superseded draft of a 411-char help string under 31 green checks. Once
the source has moved, that stale fill is indistinguishable **by value** from a
real translation — 2648 of 3010 leaves differ from `en`, so "untranslated AND
differing from the source" describes an empty set, not a noisy one.

**What is new.** `os i18n extract --source-hashes` writes
`<locale>.source-hashes.generated.ts` beside each generated bundle: per leaf,
the digest of the source revision that leaf is **still a byte copy of**.
`withSourceFallback` takes that table as a fourth argument and now judges the
`objects` / `metadataForms` sections as well as the hand-authored ones, so a
leaf whose source has moved underneath it serves the current source string
instead of a superseded draft — the same degradation an untranslated key already
produces, which is the invariance the #8765 ruling turned on.

The generated half needs one conjunct the hand-authored half does not: the leaf
must still hold the recorded bytes. Its hash table is itself generated, so a
translator cannot be asked to refresh a digest by hand the way
`<locale>.source-hashes.ts` asks; without that conjunct, re-translating a stale
leaf would leave the old record standing and report the fresh translation as
stale forever. With it, editing the value clears the flag by itself.

**Behaviour on the day it lands: unchanged for every leaf.** Records are
written only where a leaf is currently a byte copy of the **current** source, so
every record equals the current digest and nothing is stale. Measured across the
nine bundle sets: 9030 translated leaves, 1543 byte-equal to `en` (records
written), 7487 differing (left with no record — legacy-trusted, per the ruling's
property 1, since nothing in the tree says which revision they were made from).
No committed bundle changed a byte.

**Scope.** `--source-hashes` is off by default and `@objectstack/platform-objects`
is the one bundle set that opts in, by documenting the flag in its extract
config. The other eight sets keep exactly today's behaviour and can be enabled
file-by-file later; a set with no companion is entirely legacy-trusted.

The false "this hole cannot occur there" note that kept the generated sections
out of the mechanism is corrected in `source-hash.ts`, with the measurement that
falsifies it.
