---
'@objectstack/cli': patch
---

docs(cli): give the true reason the `flows` translation group stays author-warned (#20339)

The doc comment on `authorWarnedTranslationGroups` (published in `dist/` as
`utils/i18n-extract.js` and `.d.ts`) said no shipped runner reads the `flows`
group, so a translated wizard string is stored and never shown. That stopped
being true when the liveness ledger flipped `translation.flows.screens` to
`live`: the console's screen-flow runner reads each screen's `title` and each
field's `label` / `placeholder`. The comment now matches the ledger's `flows`
row: only the flow's own `label` is read by nothing yet (#20318), and the warn
is group-level, so it still covers the whole group.

No behaviour moves. The `flows` row is still `planned` with `authorWarn`, so
`os lint` and `os i18n extract` still hold back every `flows.*` key exactly as
before; that lifts when the row flips, with no edit to the CLI.

Clause-②: no
