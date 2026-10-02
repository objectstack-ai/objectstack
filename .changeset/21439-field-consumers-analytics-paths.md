---
'@objectstack/lint': patch
---

`field-no-consumers` no longer calls a field "inert" when a dataset or cube member reads it through a relationship path (#21439).

Clause-②: no

`os validate`, `os build` and `os lint` warned "Verdict: inert — no site of any kind names it" for every field an analytics member reached through a path such as `account.revenue`, so an author following the warning would delete a column a measure reads. The four slots that name a column are a dataset dimension's and measure's `field` and a cube dimension's and measure's `sql`. Each one now credits every field its path reads: the lookup on the base object, each intermediate lookup, and the column on the object the last hop reaches.

- **Hops resolve the way the analytics door resolves them.** A cube hop goes through the join the cube declares for it, else the lookup's `reference`. A dataset hop goes through the `reference` its compiler joins through, and only where the dataset's `include` declares the join.
- **A bare cube column is credited too.** Before, a cube member's `sql: 'amount'` credited nothing, because a cube names its object in its own `sql`.
- **A path the door refuses reads nothing.** Examples: a join the dataset's `include` does not declare, a hop that names no relationship, a column the last object does not have. Each field such a path names is now listed as a carrier site that a removal must clean (`carrier-only`), not as a reader.
- **A path the object graph cannot judge** credits the fields it does resolve. An example is a lookup to an object this stack does not define.

Nothing new is refused, and the rule stays a warning. One warning can appear where there was none: a path the door refuses through a lookup named after its target object (`account.revenue`, with `account` a lookup to the object `account`). The old text scan credited its column as read. It is now reported `carrier-only`, beside the error the refused path already carries.
