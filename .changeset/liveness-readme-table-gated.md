---
"@objectstack/spec": patch
---

`check:liveness` reconciles the ledger README's "Current state" table against `GOVERNED`,
and the two rows it was missing (`api`, `capability`) are back-filled.

That table is the liveness ledger's own index — one row per governed type, counts
regenerated from the gate's `--json` report, and a hand-written Notes cell recording how
each type got where it is. It opens with a heading of the form
`## Current state — N governed types (complete registry coverage)`, which is a completeness
CLAIM, and nothing could falsify it: `N` was the count of ROWS, not of governed types, so
the two agreed only by coincidence. They stopped. `api` (seeded 2026-08-04, #5271/#5206,
PR #5312) and `capability` (seeded 2026-08-08, #5961, PR #6540) were both in `GOVERNED`,
both had ledgers, both were counted by the gate, and neither had a row — under a heading
that still read as true to every subsequent reader (#7257).

This is the shape the file spends 500 lines warning about, one level up. `dashboard.widgets`
asserted in prose that its 22 child keys were "classified in the DashboardWidgetSchema
subtree" — a subtree that never existed — and survived a release because **prose cannot fail
a build** (#4956). Every other claim in that file has since become data the gate resolves:
schema → ledger, ledger → schema, container → declared disposition, `GOVERNED` → the
metadata-type registry in both directions. The index was the last one riding on a human
reading it.

So it becomes the gate's fourth direction (`scripts/liveness/readme-table.mts`, pure and
unit-tested for the same reason as `orphans.mts`: on a green tree the table is complete, so
a passing run proves nothing about whether the check can fire). It FAILS — not warns — when
a `GOVERNED` type has no row, when a row exists that `GOVERNED` does not back, when a type is
claimed by two rows, or when `N` disagrees with either the row count or `GOVERNED.length`.
All three heading legs are checked, because two of them agreeing is exactly the state #7257
found. No new `check:`/`gen:` script: it rides inside `check:liveness`, which the
`Spec property liveness` workflow already runs on every PR touching `packages/spec/**`.

The documented regeneration snippet now reads the table back as well as the report, so a
governed type with no row prints a **skeleton row** instead of silently not being printed
next to its siblings — the omission surfaces at regeneration time as well as at CI time.
Both were needed: the count columns get regenerated far more often than the row set gets
audited.

What the gate deliberately does not check is the Notes cell, which is hand-written
measurement — a manufactured one is worse than a missing row, and that is why the two rows
were filed rather than fixed on the spot. Both are back-filled here from their seeding PRs'
own measurements: counts from `--json`, prose from what #5271/#5312 and #5961/#6540 actually
measured. Both types turn out to be the same worked example — **enforced but undeclared**,
the mirror of this ledger's usual `declared ≠ enforced`: each was already being consumed at
runtime while absent from the metadata-type registry, so `saveMetaItem` stored arbitrary JSON
against it. Docs and tooling only; no runtime behaviour changes.
