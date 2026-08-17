---
"@objectstack/objectql": patch
"@objectstack/driver-sql": patch
---

fix(objectql): a caller value containing " - " no longer eats the diagnostic's template head, and no longer leaves its own suffix in the log (#9275)

`redactStatementFromMessage` cuts the bound statement off a driver error at the
**last** ` - `, because a bound value may itself contain that separator and
cutting at the first would leave a fragment of the value standing.

When the value the DATABASE inlines into its own diagnostic also contains ` - `,
that reasoning inverts: the last separator lands **inside the diagnostic's
value**, so the cut discards the template head — the half that could not leak —
and keeps a suffix of the caller's data, which is the half that does. Re-measured
at HEAD on live PostgreSQL 16.13 with the canary
`SENSITIVE-CANARY-9275 - 2026 - Q3`:

```
raised:   insert into "t" ("age") values ($1)
            - invalid input syntax for type integer: "SENSITIVE-CANARY-9275 - 2026 - Q3"
logged:   Q3" [statement and bound values redacted]
```

`Q3` is the caller's data, at ERROR level, which is what this neighbourhood
exists to prevent. Families with a right anchor (`for key …`,
`for column … at row N`) already recovered through their `tail` pattern; the ones
whose value runs to end of message had nothing to recover from.

**The cut is now template-aware.** When a separator in the message stands
immediately before a diagnostic head this file has measured, that separator is
the true cut point whatever its position: the head survives and the value after
it — separator and all — is dropped whole by the template that owns it. After
the fix the same error logs
`invalid input syntax for type integer: [value redacted] [statement and bound
values redacted]`, so the operator keeps strictly more diagnostic than before.

**Three families, not the two the card named.** `pg 22003` was left without a
head-gone recovery on the reasoning that an out-of-range value is a number and a
number cannot contain ` - `. Measured through the driver's own bind path, that is
false — Postgres detects the overflow while scanning digits, *before* it rejects
the trailing junk, so it echoes the caller's whole string:
`insert({ age: '99999999999 - 2026 - Q3' })` logged `Q3` too. It keeps its right
anchor, so it takes the #8823 anchor recovery rather than the new cut.

The trade this takes deliberately, and its bound: matching a template before the
cut lets a hostile value steer where the cut lands. That steering is bounded to
**over-redaction, never exposure** — a template may declare a head only if its
value runs to end of message, so a cut landing inside a statement is swallowed
whole by that template; and the **last** matching head wins, so a value that
mimics a head is cut at the mimic and cannot survive behind its own decoy. What a
crafted value can do is suppress a real diagnostic; that cost is asserted by its
own case rather than left to be discovered. The six identifier-bearing families
the live probe pins are untouched — over-matching deletes the diagnostic an
operator came for, and remains the expensive direction.
