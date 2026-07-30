---
'@objectstack/service-automation': minor
'@objectstack/formula': minor
---

Warn on flow-node `config` keys the node type does not declare (#4045).

`FlowNodeSchema.config` is `z.record(z.unknown())`, so a misspelled or invented
config key was accepted in total silence: `visibleIf` instead of `visibleWhen`
registered cleanly, was never read, and the only symptom was a feature that quietly
did not happen. That diagnostic vacuum is what made #3528 take three passes and two
wrong diagnoses to resolve.

`registerFlow` now compares each node's `config` against its descriptor's
`configSchema` and warns on anything undeclared, located and with the declared set
listed:

```
[flow 'lead_conversion'] node 'screen_1' (screen): unknown config key `visibleIf`
  at config.fields[0].visibleIf — It is not declared by this node type's
  configSchema, so nothing reads it. Declared here: name, label, type, required,
  visibleWhen.
```

The walk descends where the schema declares structure and **stops at free-form
keyValue maps**, whose keys are author data (`filter: { status: 'stale' }`).
Descending matters: the #3528 typo class lives *inside* the `screen` field
repeater, so a top-level-only comparison would miss the exact mistake this exists
to catch.

**Warn, never reject.** An undeclared key is an author typo, a key the executor
genuinely reads that its hand-written `configSchema` never declared (`notify.source`
was exactly this), or dead config. Only 4 of the 13 schema-carrying builtins have
been audited for the second population, so hard-failing would gamble on the other
nine. Tightening to an error is a later, per-key decision once this warning has
measured the real distribution. Nothing about the published `configSchema` changes,
so no consumer sees a different shape.

`@objectstack/formula` now exports `nearestName`, the edit-distance helper already
used for unknown-field and unknown-role suggestions, so "did you mean?"
diagnostics share one threshold. It is deliberately a bonus rather than the
mechanism — `visibleIf` → `visibleWhen` is distance 4 against a threshold of 3, so
the declared set is always listed instead of only as a fallback.

Also fixes the first real finding from the new check: `showcase_inquiry_purge`'s
`get_record` node carried `mode: 'records'`, which no executor reads, with a comment
crediting it for behaviour that `limit > 1` actually produces.
