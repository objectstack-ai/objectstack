---
'@objectstack/spec': patch
---

`check:skill-examples`: make the marked-block EXTRACTION loop fence-aware, not just the orphan scan

The orphan-marker scan learned to ignore an `os:check` marker shown as example text inside a
wrapping fence, so this gate's own convention could be documented in the very roots it governs.
The extraction loop was deliberately left out of that fix, and kept recognising a bare ` ```ts ` /
` ```tsx ` / ` ```typescript ` fence-open line wherever it appeared, with no notion of sitting
inside another fence. A marker *alone* nested in an illustration was therefore handled correctly,
while a **fully worked** one — the marker AND a real ts fence, both written as example text inside
a wrapper — was extracted and handed to `tsc` as a genuine example: compiling by luck, or failing
the whole gate with a diagnostic pointing at documentation prose.

Both loops now read one `fenceOwners()` walk. It records, per line, which top-level fence owns it,
so `owners[i] >= 0` answers the orphan scan's question ("is this marker inside a fence?") and
`owners[i] === i` answers extraction's ("does this ts fence open at top level?"). Because the
extraction loop's fence-open pattern is a strict subset of the CommonMark one the walk uses, a
genuine top-level block always owns itself and the new guard cannot suppress one.

No occurrence in the corpus tripped this, so the counts are unchanged either side of the fix (257
marked examples across 99 files, three surfaces). The self-test is where the defect is measurable:
a nested worked illustration whose payloads are deliberately uncompilable now extracts nothing,
while the identical payloads with the wrapper removed all extract — and the same pair is pinned
inside a JSDoc-gutter-wrapped docblock, where fence ownership has to be judged on the
gutter-stripped lines.
