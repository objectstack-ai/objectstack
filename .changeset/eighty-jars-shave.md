---
"@objectstack/metadata-protocol": patch
---

Publishing a package no longer promotes another package's draft row.

`publishPackageDrafts` lists a package's pending drafts with
`listDrafts({ packageId })`, but the promotion then re-resolved each row without
the ADR-0048 `package_id` dimension. Overlay rows are keyed by
`(org, type, name, package_id)` precisely so two installed packages shipping the
same name keep separate rows, so that lookup could not tell them apart: with two
packages holding drafts for the same `(type, name)`, publishing package A
promoted package B's unreviewed draft to active, drained B's draft row, recorded
it under A's ADR-0067 commit and ADR-0010 audit row, and left A's own edit still
pending — while answering `success: true`. Which of the two rows won was
driver-order dependent, so on a real driver this was a coin toss per publish.

The listed row's `package_id` is now threaded through to the promotion, which
resolves and drains the draft under the same key it was listed by. Publishes
that name no package (`publishMetaItem`) are unchanged.
