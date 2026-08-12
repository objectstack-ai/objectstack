---
"@objectstack/formula": patch
---

fix(formula): `==` / `!=` between a date STRING field and a Date-valued binding no longer answers a silent `false` (#7168)

A mixed-provenance comparison — the shape a hook or validation predicate writes
every day — returned the wrong boolean with no fault and no log line:

```text
record.due == previous.due
  with { record: { due: "2026-06-20" }, previous: { due: Date(2026-06-20T00:00:00Z) } }
  ->  { ok: true, value: false }        // same field, same instant
```

`previous` arrives from the driver hydrated as a `Date`; `record` arrives from a
JSON payload as a `"YYYY-MM-DD"` string. cel-js compares a `string` against a
`google.protobuf.Timestamp` and never matches, so the predicate answered `false`
— and `!=` on the same pair answered `true`. Nothing errored, so nothing pointed
at it. This is the failure class that hurts most in an AI-authored filter: the
wrong answer is shaped exactly like a legitimate one.

`rewriteTemporalEquality` already fixed this for a temporal **call** counterpart
(`record.due == today()`, #3183) by coercing the string operand with `date(...)`.
It now covers a Date-valued **binding** counterpart as well. A binding's runtime
type is not visible in the AST, so this arm is decided per row against the values
in the evaluation scope, and its verdict is deliberately never cached against the
expression source.

**Comparisons that change answer** — one operand an ISO-8601 date/date-time
string, the other a binding holding a `Date`:

- `record.due == previous.due` (same instant) — was `false`, now `true`
- `record.due != previous.due` (same instant) — was `true`, now `false`
- either operand order, and a `"…T14:33:00Z"` string against the same instant

**Comparisons that deliberately do NOT change** — the coercion requires the
counterpart to be a real `Date` *and* this operand to be an ISO-8601 string that
parses, so everything below answers exactly as it did before:

- two strings — `"2026-06-20" == "2026-06-20"` stays STRING equality
- two `Date`s — already compared as instants
- a different calendar day — stays `false`
- a non-date string against a `Date` (`"hello"`) — stays `false`
- a **numeric** string against a `Date` (`"5"`) — stays `false`. Load-bearing:
  `new Date("5")` and `new Date("05")` both parse to 2001-05-01, so coercing here
  would invent an equality between two different strings
- a date-ONLY string against a `Date` carrying wall-clock time — stays `false`.
  `date()` parses, it does not truncate to a calendar day, and those are
  genuinely different instants; truncating both sides would turn a correct
  `false` into a wrong `true` for real datetime comparisons
- ordering (`<` / `>=`) is untouched — that path is ADR-0032 §1c's retry
- a string LITERAL counterpart is untouched — it is not a binding

Cross-type `in` membership (`record.n in [1, 7]` with `n: "7"`) is a separate
clean-path question and is unchanged, deferred by maintainer ruling on #7168
pending a measured victim.
