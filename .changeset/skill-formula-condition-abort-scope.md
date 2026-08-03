---
---

Docs-only: the `objectstack-formula` skill's `previous` binding-scope table
never said what an unevaluable hook `condition` now costs (#4814).

§5 ("Update hook condition — `previous` vs `record`") is where an AI author is
taught to write `previous.x != record.x`, and the mechanical translation table
sends `OLD.x` / `ISCHANGED(x)` to the same place. The table listed exactly where
`previous` is **unbound** — insert events, and `multi: true` predicate bulk
updates — and then closed with "referencing `previous` where it is unbound makes
the whole expression unevaluable", which was the pre-17 outcome: a `logger.warn`
and a hook that did not fire.

#4775 changed that outcome: an unevaluable condition **aborts the operation**,
`before*` and `after*` in the same direction, with an error naming the hook and
the key. So the table's own rows changed meaning — "this quietly disables your
hook" became "this fails your write" — without a word of the table changing.
That is the drift this fixes: the surface teaching the idiom was the one surface
still describing the old consequence.

Adds, in §5:

- the #4775 rule, with the reason the two outcomes had to split (a `before*`
  guard swallowed into `false` let writes through; an audit hook swallowed into
  `false` dropped records — opposite failures out of one collapsed result), and
  the note that `onError` is not an escape from it (it governs a handler that
  throws; the condition is evaluated before any handler runs);
- the `multi: true` cell in full (#4800/B1): one hook condition reading
  `previous.*` fails *every* predicate bulk update of that object, fail-loud
  takes no exception, and the error is a diagnosis — it names the batch, says
  the N matched rows have no single prior record, and gives the two real ways
  out (drop `previous`, or write by id). A record-change flow trigger is
  explicitly **not** one of them: it binds the same lifecycle hook and gets the
  same unbound `previous`. `record` is the bare payload on that path too, so a
  declared field this write does not set is unevaluable as well.

Plus a pointer under the legacy → CEL table, since `OLD.x` / `ISCHANGED(x)` are
how a migrating author arrives at `previous.x` in the first place.

Releases nothing.
