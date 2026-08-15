---
"@objectstack/platform-objects": patch
---

fix(platform-objects): a translated Setup/Studio/Account label whose source string has been edited underneath it now serves the source text instead of the stale translation (#8765)

The `apps` / `dashboards` / `pages` half of this package's i18n is hand-authored
per locale. Every gate over it judges **presence or ownership** —
`app-nav-translation-parity.test.ts` (a translation exists for every declared
id, and none outlives its declaration), `check:i18n-coverage` (ratchets
*untranslated* labels), `check:app-nav-i18n` (a label per locale on the merged
nav tree). A translated value that has gone **stale** satisfies every one of
them: it is present, it is owned, it is not untranslated.

So a source-string edit left `zh-CN` / `ja-JP` / `es-ES` serving the previous
translation indefinitely, under a fully green build — which is how
`widget_recent_events` shipped its pre-conversion title in all four locales.
Pinning `en` to the declared source did not create that drift, but it removed
the one accidental symptom that made it visible: the drift stopped being
uniform across four bundles and became locale-specific, invisible to every
reviewer who reads the product in English.

**Ruled Option B** (#8765): record the source hash at translation time; a hash
mismatch marks the translation stale, and stale falls back to the source text.

- Each translated locale ships a `<locale>.source-hashes.ts` table recording,
  per leaf, the digest of the `en` source string that leaf was translated from.
  `setup.translation.ts` compares them against the current source when it
  assembles the bundle the kernel is handed.
- **Edit a source string** ⇒ that leaf falls back to the source text in every
  locale that had translated it.
- **Update one translation** (its value *and* its recorded hash) ⇒ **that locale
  alone recovers**; the others keep falling back.
- **A leaf with no recorded hash is legacy-trusted**, not stale. The tables were
  backfilled once from the then-current source, so no existing translation
  degraded when this landed.

**No new failure mode, and no new gate.** The fallback substitutes the source
string rather than deleting the key, so no key set moves; a translated locale
carrying the source string verbatim is exactly what the extractor already
writes for an untranslated key under `--fill=default`, and exactly what the
resolver's locale chain has always rendered. Staleness degrades what is
*served* — it never fails a build, which would put a four-locale translation
task in front of every one-word source edit.

Scope is the hand-authored sections only. `objects` / `metadataForms` are
generated, and the hole cannot occur there: `os i18n extract` rewrites the `en`
bundle from the source on every run and does not merge the default locale, so a
source edit either lands in the generated bundle or fails `check:i18n` as drift.
