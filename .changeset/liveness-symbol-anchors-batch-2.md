---
"@objectstack/spec": patch
---

chore(spec): re-anchor the `manifest`, `datasource`, `permission`, `dataset` and `webhook` liveness ledgers to consuming symbols (#13003)

Adoption batch 2 of the symbol-anchor citation grammar landed by #12516, following
batch 1's `action` / `object` pass. The `liveness/` ledgers ship inside this
package's npm tarball (they are named in `files`), so this is a published-data
change even though no runtime behaviour moves and no schema key changes.

One hundred and five `path:NNN` evidence citations across
`liveness/manifest.json` (34), `datasource.json` (28), `permission.json` (25) and
`dataset.json` (18) are now written `path#symbol`, each re-closed by reading the
code on the current tree rather than by shifting a line number. A symbol moves
with its consumer, so the pointer survives the in-file drift that rots a line,
and goes red when the consumer is renamed or deleted — a direction a stale line
can never produce. Every entry touched is stamped `verifiedAt: 2026-08-28`, which
dates `datasource.json`, `dataset.json` and `webhook.json` for the first time.

What the re-closure found, which is again the reason the migration is not
mechanical: 88 of the 105 citations were pointing at the wrong place already,
every one of them IN RANGE and so invisible to all three existing checks. They
had drifted onto docblocks, blank lines, a `variant: 'secondary'` UI action, a
`return m.aggregate` belonging to a different key, and — for `datasource.ssl` —
a contiguous run of five wrong pointers into a docblock about an unrelated
environment variable. Two prose claims were falsified outright and are withdrawn:
`external.validation`'s note credited `checkOnBoot` with gating the boot sweep
(nothing reads that key anywhere; the sweep is unconditional), and
`objects.viewAllRecords` cited a reader named `hasViewAllData` that no longer
exists in the tree.

`webhook.json` is the batch's separate case. All eleven of its `live` entries
cited bare FILENAMES with line numbers (`auto-enqueuer.ts:266`), which the
evidence scanner cannot parse as citations at all — so that ledger contributed
zero resolvable paths and was never actually asked about by any check. Rewriting
them as repo-rooted anchors made them askable, and the key-mention check
immediately found a real answer: the dispatcher reads the remapped `active`
column and never the authored `isActive`, so that call site now lives in the
entry's note rather than in its evidence.

`tool.json` is deliberately unchanged: every one of its citations points into
`packages/services/service-ai`, the closed cloud runtime, which is absent from
this checkout — there is no code here to re-close it against.
