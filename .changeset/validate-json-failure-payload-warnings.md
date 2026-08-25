---
"@objectstack/cli": minor
---

feat(cli): `os validate --json` carries the computed advisory lists on every failure exit, not the success payload alone (#12047)

**Machine-contract widening on the `--json` failure payloads.** A consumer that
today branches on `warnings` being ABSENT from an `os validate --json` failure
payload, or that reads it as "the author-time rule advisories", sees a
different shape after this change.

## What was wrong

The text face prints its advisory blocks ending `— re-run with --json for the
full list`, but `warnings` lived on the TERMINAL SUCCESS payload only — plus
`ruleAdvisories` alone on two of the five failure exits. So the remedy the
notice named returned a payload that did not contain the list, and the author
could not reach the withheld entries by any route until an unrelated later
failure was fixed.

The strongest instance is the parse-failure exit. `validate.ts` computes the
#3786 undeclared-authoring-key findings **before** the schema parse, precisely
so a finding survives an unrelated schema error — the parse is what strips the
key, so it cannot be recovered afterwards. That payload then dropped the list
anyway, defeating the one hoist that existed to prevent exactly this.

## Which exits gain the field

All five failure exits of `os validate --json`. Two already carried a partial
list; three carried none. `warnings` is now present on every one, alongside
each exit's existing keys, which are unchanged:

| exit | existing keys | `warnings` before | after |
| --- | --- | --- | --- |
| protocol parse failure | `errors` | absent | undeclared-key findings |
| author-time rules failed | `errors` | `ruleAdvisories` | rule + key |
| capability provider check | `errors` | absent | rule + key + capability |
| package docs failed | `errors` | `ruleAdvisories` | rule + doc + key + capability |
| thrown / caught | `error` | absent | what the run had computed |

The success payload is unchanged in content: its
`[...ruleAdvisories, ...docWarnings, ...unknownKeyWarnings, ...capProviderWarnings, ...structuralWarnings]`
spread moved to a single `warningsSoFar()` site that every exit now reads, so
the member order cannot drift between exits.

`structuralWarnings` is the one member `os validate` has that `os build` does
not, and it is **carried, not hoisted**: it is computed below all five failure
exits, so it rides each of them as an empty list and the success payload stays
the only exit that can ever show it non-empty.

## What a consumer keying off its absence should do instead

⛔ `warnings` is no longer a signal of which exit produced the payload. Read
`valid` (and `error` / `errors`) for that; a consumer that inferred "this is a
failure payload" from a missing `warnings` must switch to `valid === false`.

⛔ `warnings` on a failure payload is no longer only the author-time rule
advisories. It is the same heterogeneous list the success payload publishes —
rule and doc findings as RECORDS, undeclared-key and structural advisories as
STRINGS — truncated to what the run had computed. A consumer that assumed every
entry was a rule finding must classify by shape.

⛔ `warnings: []` on a failure payload does NOT mean "this tree raises no
advisories". It means **this run stopped before those advisories were
computed** — a config that fails to load reports `[]` by construction. A
consumer that needs the full advisory set for a tree must read it from a run
that reaches at least the gate that computes it.

✅ `warnings` is always an array on every `os validate --json` payload, success
or failure, so it can be read unconditionally — that shape constancy is the
point of the change (maintainer ruling 2026-08-25 on #11772, option 1 of three,
inherited here under the same-family rule; option 2, "carry them only where the
text face printed them", was rejected as the hardest contract to declare).

Exit codes are untouched: every failure exit still exits 1, and `--strict`
still reads the text face's own list, so `os validate --json --strict` reaches
the same verdict it did before.

Advisories stay CARRIED, never recomputed: each list is still computed at
exactly the step that owns it, so an exit upstream of a step legitimately
reports that list empty and no failure path pays for a computation it did not
already do.
