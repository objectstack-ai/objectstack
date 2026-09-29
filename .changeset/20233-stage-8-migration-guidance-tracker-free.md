---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for twenty-four more migration-entry families — `stack-*`, `evaluated-*`, `aggregation-*`, `authoring-*`, `automation-*`, `cache-*`, `tenant-*`, `client-*`, `spec-*`, `cli-*`, `identity-*`, `import-*`, `tool-*`, `advanced-*`, `cloud-*`, `startup-*`, `sys-*`, `declarative-*`, `sort-*`, `address-*`, `packages-*`, `platform-*`, `session-*` and `strategy-*` — states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries of these twenty-four families are printed by `os migrate meta`
as the header, `why:` and `verify:` lines of a manual change. Their text sent the reader to
issue-tracker, pull-request, decision-batch and summon numbers — some of which no longer
resolve, and some in another repository or a vendor's tracker — for what a ruling,
measurement or fix had decided; it now says what was decided, in the sentence being read.
ADR ids are kept, and so are the rule numbers of this repository's own contributor guide.

Two entries also carried a tracker number in `surface`, the header line itself:
`authoring-schemas-strict-unknown-keys` now names the unknown-key strictness wave, and
`evaluated-expression-slots-source-required` names the census of engine-evaluated slots.
One sentence is corrected while being rewritten: `cli-command-contribution-retired` said the
`manifest.contributes.commands` tombstone was protocol 17; it is registered under protocol 18.

Text only: no entry id, `from` / `to`, conversion or matching logic changes, and the chain
rewrites exactly what it rewrote before. The generated migration registry,
`spec-changes.json` and the protocol upgrade guide carry the same text.
