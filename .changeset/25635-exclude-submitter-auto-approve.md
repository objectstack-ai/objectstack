---
'@objectstack/spec': minor
---

feat(spec): an approval node refuses `excludeSubmitter: true` beside `onEmptyApprovers: 'auto_approve'`

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Ruling-ref: 6386627950

An approval node's `excludeSubmitter: true` removes the request's submitter from the slate its `approvers` resolve to. When that leaves nobody, the request takes the node's `onEmptyApprovers` route, and under `'auto_approve'` that route approves the request with no one deciding: a submitter who is the only approver would get their own request approved, the one outcome the option exists to prevent. The approval node config now refuses the pair at the parse, with one issue at `onEmptyApprovers` naming both keys, so `os validate`, `compile`, `defineStack`, the flow build judge and the metadata save door all refuse it before it is deployed. Choose a policy that never passes the request instead: `'admin_rescue'` (the default, which opens the request on the organization's administrators), `'fail'`, or `'fallback'` with a `fallbackApprovers` list naming who decides.

- **Narrows nothing a released version accepted.** `excludeSubmitter` is new in this same release (its own changeset declares it), and no published `@objectstack/spec` carries it, so no package source or stored approval node written against a released version can hold the pair.
- **Only `true` arms it.** `onEmptyApprovers: 'auto_approve'` beside `excludeSubmitter: false`, or with the key omitted, parses as before and keeps its meaning. Every other policy parses beside `excludeSubmitter: true`.
- **The approval engine is unchanged.** Removing the submitter at run time is still to come; this change makes the contract refuse the one combination that would let an emptied slate pass.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves for an upgrading consumer: the refused pair needs `excludeSubmitter`, a key added in this same release and absent from every published `@objectstack/spec` (the latest on npm, 18.1.0, carries no `excludeSubmitter` anywhere in its tarball), and no producer in this repository writes it, so no stored row or package source written against a released version holds the pair and there is nothing for `objectstack migrate meta` to rewrite. No spec key, authorable spelling or stored shape is removed, renamed or re-shaped, and the remedy for an author who writes the pair is a choice among three policies, not a mechanical rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
