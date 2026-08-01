---
"@objectstack/service-automation": minor
---

fix(automation): `evaluateCondition` decides the dialect from the source, not from the caller (#4336)

`AutomationEngine.evaluateCondition` picked its engine by asking whether an
`{ dialect, source }` **envelope** was present. A condition handed to it as a
plain string therefore never reached the CEL engine: it fell through to the
legacy `{var}` template path, which substitutes brace holes and then compares
whatever text is left — **as text**. Nothing errored, and the run was recorded
as `success`, with the failure direction depending on the predicate:

| Handed in | Actually evaluated | Result |
|:---|:---|:---|
| `existingTask == null` | `'existingTask' === 'null'` | always **false** — gate never opens |
| `record.rating >= 4` | `'record.rating' >= '4'` → `'r' > '4'` | always **true** — branch pinned open |

#4414 fixed the one built-in that was reaching this — the `decision` executor
now wraps `conditions[].expression` in a CEL envelope before calling. This
fixes the **evaluator**, so the next caller does not have to remember: the
dialect is now read from the source, and a condition is CEL unless it actually
contains a `{var}` hole. `evaluateCondition` is public API, so a
plugin-registered node executor evaluating its own predicate was getting the
table above with nothing to warn it.

**The legacy `{var}` dialect keeps working** where it always did —
`{amount} > 100`, `{status} == active`, `{a.b} == 7` — and gains the two things
it was missing:

- **A quoted literal compares as its contents.** `{status} == 'active'` used to
  compare `active` against `'active'` — quotes included — and was false for
  every value of `status`. It is the spelling the flow docs showed, and quoting
  a string literal is what every other predicate surface requires.
- **It no longer answers `false` when it could not resolve something.** A `{…}`
  hole matching no flow variable (`{lead_record.status}` — `get_record` stores
  the whole row under one name, so that key never exists) and a substituted
  value that is neither a boolean, a number, nor part of a comparison are
  refused with the source and the offending reference attached. Both used to be
  a silent `false`, which ADR-0032 §1c forbids: a predicate that cannot be
  evaluated is a fault, never a quiet branch decision.

Braces inside an explicit `dialect: 'cel'` envelope remain the #1491 brace-trap
and still throw — stating the dialect is the author saying "this is CEL". The
sniff reads the source outside string literals, so `record.label == '{pending}'`
stays CEL and compares the field.

**Tightening to know about:** a bare string that is not valid CEL now raises
where it previously string-compared to some answer. That includes the
host-language payloads the safety tests use (`process.exit(1)`,
`require("fs")…`) — nothing executed before and nothing executes now, since CEL
has no `process`, no `require` and no arrow functions, but the failure is a
reported fault instead of a silent `false`.
