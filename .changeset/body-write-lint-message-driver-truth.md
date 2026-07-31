---
"@objectstack/lint": patch
"@objectstack/spec": patch
---

fix(lint): the write-set diagnostics describe what the runtime actually does (#4271)

`hook-body-write-unknown-field` and `action-body-write-unknown-field` told
authors the undeclared column "silently never lands in the stored record".
Measured on `main`, that is wrong in **both** directions. Nothing between the
body and the driver filters the key — `applyMutationsToInput` is a plain
`Object.assign`, and `validateRecord` walks declared fields on insert and
`continue`s past a key with no field def on update — so the driver decides:

- **SQL** — the stray column enters the statement and the **whole write
  fails** with a driver-level error (`table deal has no column named stagee`).
  Nothing is stored, so the correctly-spelled fields of that row are lost too,
  and the error names a column far from the body that wrote it.
- **Schemaless** (memory, MongoDB — both spread the payload without consulting
  the declared field set) — the stray key **is** persisted, as an undeclared
  column nothing downstream reads.

A lint that misdescribes the failure it is warning about teaches the wrong
debugging instinct: an author told the value silently vanishes will not connect
the driver error they actually see to the typo that caused it, and on a
schemaless driver will not go looking for the stray key that is really there.
All three messages now state the split, matching the "What still happens at
runtime" description #4355 gave `content/docs/automation/hook-bodies.mdx`.

Both outcomes are pinned by a new integration test —
`runtime/src/sandbox/undeclared-field-write-driver-split.integration.test.ts`.
Its insert cases run the full chain (real QuickJS sandbox, real hook body, real
engine, real driver against a real SQLite table), so "reaches the driver
unfiltered" is proved rather than asserted: if anything on that path ever
learns to filter, the SQL half stops throwing and the test goes red. The rule
headers, the `ScriptBodySchema` / `ActionSchema.body` notes and the two
still-unreleased #4271 changesets are corrected to match. #4355 fixed the
prose docs; this is the same correction on the surfaces that ship in the
packages — the diagnostic an author actually reads, and a test that pins it.

`@objectstack/spec`: doc comments only — no schema or generated-artifact change.
