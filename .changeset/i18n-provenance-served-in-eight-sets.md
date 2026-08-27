---
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-audit": patch
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-messaging": patch
"@objectstack/service-realtime": patch
"@objectstack/service-storage": patch
---

fix(i18n): read the provenance companion at serving time, not only record it (#12642)

Maintainer ruling #12069 Option A (#11671) landed translation provenance as
**two** halves: `os i18n extract --source-hashes` RECORDS which source revision
a generated leaf is still a byte copy of, and `withSourceFallback` READS those
records at serving time and substitutes the current source for a leaf whose
source has moved underneath it. The recording half was then rolled out to every
bundle set. The reading half was not — measured on `main`: provenance
**recorded in 9 of 9** bundle sets and **read at serving time in 1**.

The other eight assembled their `TranslationBundle` straight from the raw
generated modules and never consulted the companion sitting beside them, so
they recorded the drift and went on serving the superseded draft. Nothing said
so: `check:i18n` compares key sets and they still matched, `check:i18n-coverage`
counts a present leaf as translated, and `check:i18n-stale-fill`'s cross-locale
rule needs a SECOND locale holding the same stale bytes before it can testify.
The measured case had one locale and no second witness.

All eight are wired here, in the shape `@objectstack/platform-objects`'s own
`metadata-translations/index.ts` uses — the committed
`<locale>.source-hashes.generated.ts` passed as the fourth argument, the third
left `undefined` because these sets have no hand-authored sections. Provenance
is now recorded in 9 of 9 sets and served in 9 of 9.

`@objectstack/plugin-webhooks` was the last of them and is the only one whose
manifest changed: `withSourceFallback` lives in `@objectstack/platform-objects`,
which that package did not declare. It was **already in that package's install
closure** through `@objectstack/service-messaging`, so the edge declares a
resolution that already resolved rather than adding a package to the graph —
and relying on it undeclared would have been a phantom dependency under this
repo's strict package manager.

`check:i18n-stale-fill` gains a second verdict, **UNSERVED PROVENANCE**, so this
cannot silently come apart again: a bundle set that commits a companion and
does not consult it at serving time now fails the build, including a tenth set
that lands tomorrow.

**Graded `patch`, and the grade is the interesting part.** No API changes, no
new exported surface, and no key set moves — substitution was chosen over
deletion precisely so key-set claims stay put (ruling #8765 Option B). What
changes is which STRING a stale leaf serves. On this tree that is **zero
leaves**: a record is only ever written for a leaf that IS a byte copy of the
current source, so the companions arrive 0-stale by construction. The change is
in what happens the next time a source string moves — the reader sees the
English source rather than a superseded draft of it, which is the same
degradation an untranslated key already produces and not a new state.
