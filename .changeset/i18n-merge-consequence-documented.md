---
"@objectstack/cli": patch
---

docs(cli): document the i18n merge consequence for a corrected source string (#9672)

`os i18n extract` merges against committed bundles by default so a re-run never
wipes a hand translation, and `--fill=default` only fills gaps. That means a
source label/description that is later **corrected** does not propagate into a
locale that already holds a translation of the old text — a present-but-stale
string is not a gap, so it is left as-is. This was always the behaviour and
remains unchanged; it was simply undocumented where the next reader looks.

Two places now say so: the merge-options comment in `os i18n extract`'s command
implementation, and the header comment written into every generated
`<locale>.objects.generated.ts` / `<locale>.metadata-forms.generated.ts` bundle.
Committed bundles across the repo are regenerated so their header matches the
new template (translated content is unchanged).

`check:i18n`'s bundle-drift verdict still proves generated output matches the
schema; it does not compare a translated value against its source's meaning
(that remains an open appetite question, tracked separately — see #9672).
