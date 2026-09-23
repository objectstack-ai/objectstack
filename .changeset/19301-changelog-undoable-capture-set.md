---
"@objectstack/spec": patch
---

fix(spec): the published `effae80` changelog entry states ONE `undoable` capture set — the one that shipped (#19301)

Clause-②: no

`packages/spec` ships `CHANGELOG.md` inside its npm tarball (it is named in
`files[]`), so an entry there is a published surface — the text an upgrading
agent greps. The single entry for `effae80: feat(spec): a row action gets the
declarative single-record field write` stated BOTH capture sets, four lines
apart:

> `undoable` now has its anchor — the patch names exactly the fields whose prior values are captured.

> `undoable` captures the prior values of exactly the fields written.

**The second is the one that shipped.** `declarativeUpdateWrite` builds the
write bag as `{ ...patch, ...params }`, and `executeDeclarativeUpdateAction`
keys `undoData` off `Object.keys(data)` over that bag — so on any
params-carrying action the capture is strictly wider than `patch` names. The
same entry's own `patch` bullet already says the static values are "merged
UNDER the values `params` collects (a param of the same name wins)". The first
sentence was wrong when it was written; it is not a record of behaviour that
later changed.

The first sentence now names the merged write bag, in the wording the settled
`ActionSchema.undoable` description uses. Nothing else in the entry moves and
no other entry is touched: the correction is an **amendment in place**, not an
erratum in a later entry — a reader who greps the old promise lands on this
entry and nowhere else.

- **Prose only.** No key, export, accept set, refusal, tombstone or generated
  artifact moves; the same author input parses the same way before and after.
