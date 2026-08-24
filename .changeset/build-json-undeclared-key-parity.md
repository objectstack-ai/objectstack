---
'@objectstack/cli': patch
---

Carry the undeclared-authoring-key warnings in the `os build --json` payload,
so its `warnings` list matches `os validate --json` on the same tree

`os build --json` reported a strictly smaller `warnings` list than
`os validate --json` did for the same stack, and the missing members were
exactly the "your key was dropped at load" ones (#3786 / ADR-0087). A CI job
gating on `os build --json` therefore could not see the class of warning that
silently discards authored metadata — while the identical job gating on
`os validate --json` did.

Measured over one temp project at `origin/main` `4ceae8ab0`, three faces of one
authored stack whose field carries an undeclared key nested in `visibleWhen`:

```
os build            ⚠ Undeclared authoring keys (1) — dropped at load (#3786)
os validate --json  warnings: [ {rule record}, "…zzzUnknownKey…" ]
os build   --json   warnings: [ {rule record} ]            ← the dropped list
```

`compile.ts` computed the findings and then formatted them **inside** the
`if (… && !flags.json)` print block, which put them structurally out of reach
of the payload: computed, then discarded, for the one audience `--json` exists
to serve. `os validate --json` had this exact defect on its own face and fixed
it by mapping the findings through `formatUnknownAuthoringKey` at the
computation site; `os build` now does the same, so one list feeds both faces
and they cannot report different sets.

**No new key.** The findings land in the `warnings` key the payload already
declared — its own comment has always said "the whole registry's advisory set,
in the shape `os validate --json` reports" — carried as formatted strings
beside the authoring-rule records, which is byte-for-byte the heterogeneous
shape `os validate --json` already ships. Consumers reading `warnings` off
either command now read one shape for one class of warning. The payload's
top-level key set is unchanged and pinned as unchanged.

This also makes an existing promise true. The truncation notice added in
17.2.0 ends with "re-run with `--json` for the full list"; that pointer was
honest about the authoring-rule advisories and would have been false about the
undeclared-key list, which is why that change left the second list without a
notice.

Text output is unchanged.
