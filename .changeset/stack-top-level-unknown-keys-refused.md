---
"@objectstack/spec": minor
---

feat(spec): refuse unknown top-level stack keys — `ObjectStackDefinitionSchema` goes strict (#8687, the outermost #4001 door)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

The top-level stack definition was the last strip-mode authoring surface of
the #4001 campaign: an unknown top-level key parsed green and its value was
silently dropped. Measured on 17.0.0 GA (#8687): three injected bogus
top-level keys added ZERO warnings to `os validate` and exited 0 — even
`--strict` could not catch them, because the `defineStack:` naming diagnostic
printed at load, outside the warning tally. The failure population is a typo
or stale key (`flow` for `flows`, `approvalProcesses` after the 7.4 removal)
shipping an artifact with a whole metadata family absent at runtime — the
root of hotcrm#1141.

**What is refused:** any top-level key the schema does not declare, with a
prescriptive message naming the surface and the offending key. A near miss
carries the did-you-mean the load-time lint used to print (`objectz` →
`objects`, `flow` → `flows`) — the near-miss resolver survives, now riding
the refusal itself, and `lintUnknownStackKeys` goes quiet on the strict
surface by its own posture rule (one voice, not two). Curated prescriptions
answer the known retirements: `storage` (deployment config, `OS_STORAGE_*`),
`approvals`/`approvalProcesses` (Approval-node flows, ADR-0019), `workflows`
(`state_machine` validation rules, ADR-0020), `portals` (removed, #3464),
`onDisable` (never invoked, #4212).

**What stays accepted:** every declared key byte-identically — and `onEnable`
is now DECLARED rather than undeclared-but-honoured: `AppPlugin` has always
executed it off the authored bundle (#4095 grafts it back on artifact boot),
and a strict close of an undeclared `onEnable` would have refused the pattern
our own examples ship. `declared = honoured`, in both directions.
`composeStacks` treats `onEnable` as single-valued: same value passes, a
disagreement is refused naming both stacks.

A strict parse failure fails `os validate` outright — exit 1 with or without
`--strict` — so the CI gap closes with no warning-accounting change.

## FROM → TO

```ts
// before — parsed green; the whole flows family was silently absent at runtime
export default defineStack({ manifest, objects: [...], flow: [myFlow] });

// after — refused at parse: "Unrecognized key(s) on this stack definition:
// `flow`. Did you mean `flow` → `flows`?"
export default defineStack({ manifest, objects: [...], flows: [myFlow] });
```

There is deliberately no automatic rewrite: an undeclared top-level key
either names a capability the declaration surface does not deliver (blessing
it would be declared-but-unenforced surface, ADR-0078) or is a spelling of a
declared one, which the rejection names. `os migrate meta` surfaces the
change as a structured TODO (semantic entry
`stack-top-level-unknown-keys-refused`, protocol major 18 — this refusal is
not part of the v17.0.0 cut).

<!-- adr-0087: registered stack-top-level-unknown-keys-refused -->
