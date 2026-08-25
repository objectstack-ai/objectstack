---
"@objectstack/cli": minor
---

feat(cli): `os build --json` carries the computed advisory lists on every failure exit, not the success payload alone (#11772)

**Machine-contract widening on the `--json` failure payloads.** A consumer that
today branches on `warnings` being ABSENT from an `os build --json` failure
payload sees a different shape after this change.

## What was wrong

The text face prints its advisory blocks before the gates that can stop the
run — the #11529 author-time advisories at step 3b, the #3786 undeclared
authoring-key findings at 3d — and both end in `— re-run with --json for the
full list`. But `warnings` lived on the TERMINAL SUCCESS payload only (plus,
for `ruleAdvisories` alone, the author-time-rules failure). On a tree with 60
undeclared authoring keys *and* a package-docs error:

```
os build         Undeclared authoring keys (60) … 50 rows …
                 … and 10 more … — re-run with --json for the full list
os build --json  {"success":false,"error":"docs validation failed","issues":[…]}
                                                        ^ the 60 keys nowhere
```

The remedy the notice named returned a payload that did not contain the list,
and the author could not reach the withheld entries by any route until an
unrelated later failure was fixed — the "the remedy named is unreachable"
shape of #11643 and #11391.

## Which exits gain the field

All nine failure exits of `os build --json`. Six already had a payload of their
own; three more were found while enumerating (the filing card's table listed
six). `warnings` is now present on every one, alongside each exit's existing
keys, which are unchanged:

| exit (step) | existing keys | `warnings` before | after |
| --- | --- | --- | --- |
| `strict-body: missing body` (2b) | `issues` | absent | `[]` |
| protocol parse failure (3) | `errors` | absent | `[]` |
| `author-time rules failed` (3b) | `issues` | `ruleAdvisories` | unchanged |
| `capability provider preflight failed` (3c) | `issues` | absent | rule + capability |
| `access matrix drift` (3e) | `changes` | absent | rule + key + capability |
| `docs validation failed` (3f) | `issues` | absent | all four lists |
| `--no-runtime-bundle` refusal (4b) | `error` | absent | all four lists |
| `runtime bundle failed` (4b) | `error` | absent | all four lists |
| thrown / caught (bottom) | `error` | absent | what the run had computed |

The success payload is unchanged in content: its
`[...ruleAdvisories, ...docWarnings, ...unknownKeyWarnings, ...capProviderWarnings]`
spread — `os validate --json`'s order minus its trailing `structuralWarnings`
— moved to a single `warningsSoFar()` site that every exit now reads, so the
member order cannot drift between exits.

## What a consumer keying off its absence should do instead

⛔ `warnings` is no longer a signal of which exit produced the payload. Read
`success` (and `error` / `errors`) for that; a consumer that inferred "this is
a failure payload" from a missing `warnings` must switch to `success === false`.

⛔ `warnings: []` on a failure payload does NOT mean "this tree raises no
advisories". It means **this run stopped before those advisories were
computed** — the two early exits above (`strict-body`, protocol parse) run
before any advisory step, so their list is empty by construction. A consumer
that needs the full advisory set for a tree must read it from a run that
reaches at least the gate that computes it, or from `os validate --json`.

✅ `warnings` is always an array on every `os build --json` payload, success or
failure, so it can be read unconditionally — that shape constancy is the point
of the change (maintainer ruling 2026-08-25, option 1 of three; option 2,
"carry them only where the text face printed them", was rejected as the hardest
contract to declare).

Advisories stay CARRIED, never recomputed: each list is still computed at
exactly the step that owns it, so an exit upstream of a step legitimately
reports that list empty and no failure path pays for a computation it did not
already do.
