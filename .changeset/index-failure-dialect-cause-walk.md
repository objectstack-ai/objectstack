---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the dialect arm of `classifyIndexFailure` walks `cause` to the same depth the conflict arm does (#6848)

`classifyIndexFailure` had two arms reading two different wrap-depths. #6699
moved the first arm onto `@objectstack/types`' `isUniqueViolationError`, which
follows `error.cause` four levels down because pool and query-builder layers
re-throw with the original attached. The second — the dialect arm — kept reading
`err.message` and stopping there.

So a dialect refusal arriving behind a wrapper (outer prose `Write failed` or
`pool query failed`, the actual `near "WHERE": syntax error` one step down
`cause`) was graded `failed` instead of `unsupported`. The private
`indexFailureText` helper now collects the message channel of the thrown value
**and** of each `cause` below it, bounded at the same `MAX_CAUSE_DEPTH` of 4 the
predicate uses and counted the same way (the thrown value is depth 0). The
dialect vocabulary itself is unchanged — only the text fed to it.

**Why the verdict matters beyond wording.** The two consumers dispose of
`unsupported` and `failed` differently. `view-definition-active-index.ts` treats
them the same (keep the previous index, report at `error`; only the wording
differs). But `ensureOverlayStateIndex` builds the composite **fallback lookup
index** on the `unsupported` branch and on no other — offered precisely because
a dialect that cannot take the partial form should still get the lookup. Under
a `failed` verdict that branch never ran, so `fallback` came back
`not-attempted` rather than `ensured` / `refused` and the degradation target was
silently never attempted.

**Dormant, not a live regression.** No driver shipped today produces the wrapped
shape — each hands knex's error back with the dialect text on the outer message,
which is why every existing case matched on the first read. This closes an
asymmetry before a wrapping raw-SQL driver can land on it; it is also not a
regression from #6699, which only made the contrast visible by deepening the
first arm.

Two details worth knowing if you touch this: the collected levels are joined
with a **newline**, never a space, because two of the dialect alternatives are
multi-word (`where clause`, `near "where"`) and a space would let a phrase be
synthesised across a wrapper boundary that no single driver wrote. And a looping
`cause` chain is **bounded rather than detected** — no visited set — which is
exactly what the predicate this mirrors does.

Arm order is unchanged and still load-bearing: a conflict reported anywhere in
the chain still beats a dialect refusal in the outer prose.
