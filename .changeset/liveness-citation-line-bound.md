---
'@objectstack/spec': patch
---

liveness gate: bound an evidence citation's LINE, not just its file

`check:liveness` resolved a `path/to/file.ts:NNN` pointer with `existsSync` on the
path alone — the parser did not even retain the `:NNN` — so a consumer that moved
out of a file which still exists kept a passing pointer, was counted under the word
"resolved", and left its ledger entry reading as freshly verified. A citation that is
dead but precise-looking is worse than a missing one: it survives review, and the next
agent re-verifying the entry follows it, finds nothing, and rebuilds the call graph
from scratch.

Citations are now bounded by the cited file's length, for `evidence` and `producer`
alike (they already share one resolver). A range `:12-34` is bounded by its END. Every
citation in a `+`-joined multi-consumer entry is bounded, not just the first.
Cross-repo attributions (`objectui: …`, `cloud: …`) are still counted and never
resolved. The run prints how many citations it checked beside how many are in range,
so a parser that degraded to extracting nothing cannot read as a pass.

Two shipped instances, both repaired here and both real:
`permission.tabPermissions` cited `hono-plugin.ts:1200` in a 717-line file that no
longer mentions the property (all three of its pointers were dead — one past EOF, two
within bounds), and `mapping.fieldMapping` cited a range ending three lines past the
end of `import-mapping.ts`.
