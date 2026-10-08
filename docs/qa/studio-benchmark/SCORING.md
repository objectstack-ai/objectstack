# Studio task benchmark — scoring

How a run of [the scenario](./SCENARIO.md) turns into numbers. The sheet a run fills in is
[SCORESHEET.md](./SCORESHEET.md). The same rules score an agent run and a human session
([USER-SESSIONS.md](./USER-SESSIONS.md)); only the time column means something different (below).

## The metrics

| metric | unit | counted when | not counted |
|---|---|---|---|
| **Wall time** | seconds, per step and total | from the author's first gesture towards the step to the server-side oracle confirming it (SCENARIO.md, *The clock*) | the oracle read itself; boot and sign-in (recorded separately as *setup*) |
| **Red errors** | count + verbatim text | every red banner, red toast, red inline error box, red canvas chip, red field message or red error panel **shown** to the author — one per red element per author gesture. Two appearances of the same text after two separate gestures count twice; a banner that gains a new bullet after a new gesture counts again | a red required-field asterisk; a red count badge (notifications, *Problems N*); a red *Delete* / *Remove* button; a yellow/amber warning or publish advisory (logged under *warnings*) |
| **Failed writes** | count + `METHOD path → status CODE` | every 4xx/5xx answer to a draft write (`PUT`/`POST`/`PATCH`/`DELETE` on a metadata, draft or package route), to the publish call, and to a record write the end user makes through the console in step 8, read from the browser network log | reads (`GET`) — including background reads the console makes for the end user —, auth refreshes, telemetry, and the runner's own forged oracle requests |
| **Code-shaped entries** | count, each with step and field | each console field where the author had to type **JSON**, a **CEL / formula expression**, or a **machine name** (snake_case identifier, object or field API name, user id) because no picker or derived default existed | a label the console turned into a machine name by itself; choosing from a closed picker (a select or combobox that accepts nothing else), even one that displays machine names. A free-text field with a browser suggestion list *is* counted: it accepts any text, and a label typed into it is stored as a wrong machine name |
| **Dead ends** | count, each named with its step | a step, or a required part of one, that cannot be finished in the console at all — the only way through is a file, a hand-written API call or a CLI command | a step that is slow or error-prone but completable |

## Classifying each red error

Each red error gets exactly one class — the class says who has to move:

| class | meaning |
|---|---|
| `intermediate-state` | the product flagged a valid, unfinished state as an error (e.g. a half-built flow, a field not yet filled) |
| `author-input` | the author entered something wrong and the message said so |
| `product-defect` | a valid, finished input was refused, or the message is wrong or unreadable |
| `missing-step` | the refusal is correct, but it needs a step the script does not name and the authoring flow never surfaced (e.g. granting end users access to a new object) |
| `environment` | the boot or fixture, not the product (record it, do not count it in the headline) |

## Rework the script does not name

When a later step reveals that an earlier one needs more work (a missing grant, a rule that does
not evaluate), the author does that work where they found it. Time it as a lettered sub-step of
the step that revealed it (`8a`, `8b`, …), count its errors and entries in that step, and say in
one line what it repaired. ⛔ Do not move the time back into the earlier step: when the author
discovers a problem is part of what the benchmark measures.

## Headline numbers

The headline row of every run, in this order, is what the next release compares against:

```text
completed STEPS/8 · total TIME · RED red errors · FAILED failed writes · CODE code-shaped entries · DEAD dead ends
```

- *completed* counts steps whose oracle confirmed the result; a dead-ended step is not completed,
  and a step that depends on a dead-ended step is recorded `not-reached`, never `fail`.
- A **regression** is any headline number moving the wrong way between two runs on the same
  script, or a step changing from completed to not. Report it per step, never only as a total.

## Agent runs vs human sessions

An agent run measures **the product**: which steps are possible without code, what errors a
correct author meets, which fields demand code-shaped input. Its wall time includes the agent's
own driving and is not a human completion time — record it, compare it only against other agent
runs, and never quote it as "an author takes N minutes". Human completion time comes from the
[user sessions](./USER-SESSIONS.md), scored on the same sheet.

## Evidence

Each counted item carries text evidence in the sheet: the verbatim banner text, the network line,
the field name. Screenshots are live judgment aids and are not committed (the platform
checklist's `RUNNER.md` rule). A red error or dead end is cross-referenced to a card — an
existing one, or the card the reviewing seat files for it.
