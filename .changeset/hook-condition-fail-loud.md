---
"@objectstack/objectql": major
---

feat(objectql)!: a hook `condition` the platform cannot evaluate now ABORTS the operation (#4775)

**Breaking.** A declarative hook whose `condition` cannot be evaluated used to
emit a `logger.warn` and `return false` — the hook simply did not fire. Existing
hooks that have been getting by on that silent skip will now **fail the write**.
That is the point of the change, not a side effect: those conditions were never
enforcing anything, and the failure is how you find out.

## What changed

"The condition said no" and "the platform could not work out what the condition
says" used to collapse into one outcome, and that one outcome carries **opposite**
risks depending on the hook:

- a `before*` guard ("hold this write when the condition is met") swallowed into
  `false` **lets through** a write it was declared to stop;
- an `after*` audit ("leave a trace when the condition is met") swallowed into
  `false` **drops** a row nobody will go looking for, because nobody knows it
  should exist.

So an unevaluable condition is `declared ≠ enforced`, and it is now resolved the
way #4649 already resolved it for validation predicates one module over: reject
loudly, naming the hook and the key that would not resolve. The rejection is a
`HookConditionError` (exported), carrying `hook` / `object` / `event` /
`condition` / `reason` / `fault` / `missingKey` machine-readably.

`before*` and `after*` take the **same** direction, knowingly: a typo in an
`afterUpdate` audit condition fails the write it was only watching. One rule, one
answer — the platform does not grow a hidden second rule that makes the failure
direction depend on the event name.

A condition that never **compiled** aborts too. Its old treatment
(`condition ignored`) was the worse half of the swallow: the gate disappeared
entirely, so a declared guard let every write through and an audit fired on all
of them. It is reported at invocation rather than at bind time, so one broken
hook cannot wedge boot for an app nobody is writing to.

## What did NOT change

- A condition that evaluates **FALSE** is still just a skip, and the write still
  succeeds. Only *unevaluable* is new.
- `onError` (`abort` / `log`) is untouched and is deliberately **not** in this
  path. It governs a handler that threw; the condition gate runs before the
  handler is ever reached. Routing a condition fault through it would let
  `onError: 'log'` resurrect the exact silent skip this change abolishes, and
  would mint a third set of semantics for one word. `retryPolicy` and `async`
  are outside it for the same reason.

## Predicate (`multi: true`) bulk writes (#4800)

A bulk write matches N rows and fires the hook **once**, so `previous` is unbound
and `record` is the bare payload — there is no single prior record, and
materialising declared fields to `null` would state something false about all N.
Fail loud takes **no exception** here, but the message is a diagnosis rather than
a riddle: it names the hook, says *this is a predicate bulk write and there is no
single prior record*, and gives the route that works (rewrite without `previous`,
or target the write at one record by id).

It deliberately does **not** offer "use a record-change flow trigger instead":
that trigger subscribes to these same lifecycle hooks, so on a bulk write it
fires once with `previous` undefined too — verified against
`trigger-record-change` and the engine, not assumed. Pointing at it would have
made this very message the next `declared ≠ delivered`.

An **undeclared** key on a bulk write still gets the ordinary typo message — that
one really is a misspelling, and calling it a batch problem would send the author
to fix a field that is spelled correctly.

## Migrating

Run your app and watch for `HookConditionError`. Each one names the hook and the
key. The usual causes, in order of frequency:

- **a misspelled or retired field** — fix the condition, or declare the field;
- **an unguarded `null` comparison** (`record.spent > record.budget`) — guard
  with `!= null`. Note `has(x)` does **not** do this: a declared field holding
  `null` is still PRESENT, so `has(x)` is `true` and the ordering comparison
  still faults;
- **`previous` on a bulk write** — rewrite without `previous`, or write by id;
- **a bare identifier** (`done == true`) — hook conditions are `record`-scoped,
  so write `record.done == true`. Flow/automation conditions, which flatten
  fields to top level, are a different surface and are unaffected.
