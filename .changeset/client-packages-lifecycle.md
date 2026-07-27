---
"@objectstack/client": minor
"@objectstack/runtime": patch
---

feat(client): the eleven package-lifecycle methods (#3563 PR-4)

`client.packages` grows from install/enable to the full lifecycle the server
has shipped for three ADR generations: `update` (manifest edit),
`publish`, `publishDrafts` / `discardDrafts` (ADR-0033 whole-app draft
promotion), `listCommits` / `revertCommit` / `rollback` (ADR-0067 commit
timeline), `revert`, `export`, `adoptOrphans`, `duplicate` (ADR-0070
portability). All eleven routes existed with no SDK expression — Studio
reached them via raw fetch.

The route ledger flips all eleven rows to `sdk` and the gap ratchet drops
17 → 6 (from 27 at the start of the audit).
