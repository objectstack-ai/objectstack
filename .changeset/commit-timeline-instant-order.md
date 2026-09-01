---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): order the ADR-0067 commit timeline by INSTANT, so `rollbackToPackageCommit` stops planning off the weekday name (#13995)

`created_at` is an engine-injected audit column: it is not in `datetimeFields`,
and `SqlDriver#formatOutput` repairs it only inside `if (this.isSqlite)`. So the
live SQL dialects hand it out of the record read door as a JS `Date` while the
SQLite family hands out canonical ISO-Z text. Both ADR-0067 commit-timeline
consumers compared `String(created_at)` — and `String(aDate)` is
`"Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)"`, whose LEADING token
is the weekday NAME. Lexicographic order over those strings is
`Fri < Mon < Sat < Sun < Thu < Tue < Wed`: unrelated to chronology, stable
across the whole set, and therefore wrong on every run and wrong the same way —
there was never an "it worked once" to warn anyone.

- `listCommits` returned the package timeline in weekday-name order while
  claiming newest-first. Its own comment stated the assumption in as many words
  ("sort by the ISO timestamp") and it was false on the production default
  driver.
- `rollbackToPackageCommit` both CONSUMED that ordering and re-derived the same
  comparison itself, so neither site could correct the other. On Postgres and
  MySQL it reverted `apply` commits OLDER than the target and skipped the newer
  ones it exists to undo — a destructive operation planning off a wrong
  predicate.

Both sites now compare canonical absolute instants, through a sibling of the
`canonicalVersionInstant` helper #13382 landed one seam over in this same file
for the OCC `updated_at` comparison. The canonicalisation is reused; the
ordering is new, because `versionTokensAgree` answers equality between two
client-supplied version tokens and an ordering question needs `<`/`>`. When
either side does not denote an instant the two are compared verbatim exactly as
before, so the only verdicts that change are the pairs that denote one.

On SQLite and the memory driver both sides were already canonical ISO-Z text and
lexicographic order equalled chronological order, so nothing changes there —
which is why every test these sites had stayed green through the defect.
