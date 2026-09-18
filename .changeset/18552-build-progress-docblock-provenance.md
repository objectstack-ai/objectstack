---
'@objectstack/spec': patch
---

fix(spec): label every producer claim in the `build-progress` docblock — measured, ruled, or inferred (#18552)

Clause-②: no

The module docblock on `ai/build-progress.zod.ts` stated three producer claims
as MEASUREMENTS. It ships in this tarball (the published `files[]` carries the
`.zod.ts` sources) and is rendered verbatim into the generated reference page,
and for a CLOSED vocabulary it is the audit trail the "re-measure before you
move the array" discipline reads. One of the three was false, and a reader
deciding whether a fifth phase is warranted would have read all three as
readings.

Each producer claim now carries exactly one of three labels, defined at the top
of the module: **measured on a named reachable source**, **declared by ruling**,
or **inferred**.

- Membership is no longer described as uniformly measured. `structure`, `data`
  and `done` stay **measured** — the objectui reader's own union and coercion
  default, cited with the tree they were read against. `verify` is **declared by
  ruling** (cloud#2172, objectui#7388): at the read tree the chat panel has zero
  occurrences of `'verify'` against a control of four files for `'structure'`,
  and this repository emits no frame at all. That is a good reason for the
  member; it is not an observation, and the docblock no longer says it is.
- The cloud#1838 window — "111 seconds and 9 tool calls", "one of them
  `verify_build`" — is **inferred**: that record is not reachable from this
  repository, so the figure is carried, not measured, and which tools those
  calls were is recorded nowhere reachable. What is measured is narrower and
  stated as such: `verify_build` is a registered platform tool.
- "A turn that seeds no sample data never reports `data`" and "`apply_edit`
  turns need not report `structure`" are **inferred**. The consumer guidance
  around them is unchanged and does not rest on them: treat every phase as
  optional and compare by value.

A new `## Liveness watch` section records that `verify`, `hop` and `tool` are
declared ahead of any code that uses them, that cloud#2172 and objectui#7388
block 2 are the named carriers meant to close that, and that no gate watches it
— `BuildProgressFrame` is not a registered metadata type, so the ADR-0049
liveness ledger never sees it.

No schema, export or parse behaviour moves: `BUILD_PROGRESS_PHASES`,
`BuildProgressPhaseSchema` and `BuildProgressFrameSchema` accept and refuse
exactly what they did before.
