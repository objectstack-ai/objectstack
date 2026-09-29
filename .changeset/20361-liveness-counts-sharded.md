---
"@objectstack/spec": patch
---

`liveness/state-counts.md` is replaced by `liveness/state-counts/<type>.md`: the generated liveness counts are one shard per governed type, and no total is committed anywhere.

Clause-②: no — no schema key moves, no accept set widens or narrows, no export changes. What changes is the layout of a generated table that ships in the tarball, and no count in it moves.

The ledgers ship inside this package (`files[]` includes `liveness`), so the changed tarball bytes are: `liveness/state-counts.md` removed, forty `liveness/state-counts/<type>.md` shards added (each carries exactly the row that file published for its type), and the prose in `liveness/README.md`, `liveness/book.json` and `liveness/translation.json` that named the removed file.

- **Where a count now lives.** A type's row is `liveness/state-counts/<type>.md`, byte-for-byte the row the single file carried. The table's total is not in any file: `pnpm --filter @objectstack/spec check:liveness` sums the shards when it reads them, prints the sum on its success line, and carries it in `--json` as `countsTotal`. At this release the sum is the total the removed file published: 940 live · 5 experimental · 1 live-elsewhere · 148 dead · 9 planned = 1103 classified.
- **Why.** Every change that moved a liveness verdict rewrote the single file's total row, and GitHub's server-side merge runs no custom merge driver, so any two such changes in flight conflicted on that one line. With one file per type, changes that move different types touch different files.
- **Anything that read `liveness/state-counts.md` from the published package** reads the shard for the type it wants, or sums the shards for the total. `gen:liveness-counts` rewrites only the shards whose counts moved and deletes the removed file if a merge brings it back; `check:liveness` fails while it is present.
