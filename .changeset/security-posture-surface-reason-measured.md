---
"@objectstack/lint": patch
---

fix(lint): `validateSecurityPosture`'s `surfaceReason` claimed a coverage the ADR-0094 gate does not give it — 1 of 13 rules (#7576)

`AUTHORING_RULES` is a registry of self-describing entries, and the
`validateSecurityPosture` block's self-describing field was the least
trustworthy thing in it. Its `surfaceReason` — the written answer to "why does
this rule not run at the runtime publish gate?" — read:

> Already gated at this surface by a DIFFERENT mechanism: plugin-security
> registers an ADR-0094 authoring gate on `object` (`registerAuthoringGate`)
> that enforces **the same OWD posture rules** on every runtime write. Running
> the linter here as well would double-report one refusal in two vocabularies.

Both halves were false, and they were load-bearing: twelve of the block's
thirteen rules were enforced at no runtime door while the registry said
otherwise, and the write path is the only door a Studio tenant, a REST `/meta`
client or an MCP/AI author has.

- **Coverage.** `object-posture-gate.ts` reads exactly `sharingModel` and
  `externalSharingModel` through a local `OWD_WIDTH`, and never `fields`,
  `permissions`, `books` or `data`. It covers ONE rule id —
  `security-external-wider-than-internal`, its R2. Its other half, R1
  (env-tighten-only, ADR-0086 D1), corresponds to no lint rule, so it is not
  coverage in the other direction either.
- **Double-reporting.** It cannot happen, structurally rather than by luck.
  `saveMetaItem` runs `assertRuntimeAuthoringRules` (this table, 422
  `invalid_metadata`) *before* `runAuthoringGate` (the ADR-0094 gate, 403
  `owd_external_wider`), and both refuse by throwing. The first to fire ends the
  write, so an author earns one refusal either way.

The reason now states what was measured, including the two things that actually
block the move — a strictness rollout on `object` writes, and a per-write
snapshot that does not carry the collections three of the rules compare against.
`validate-security-posture.runtime-surface.test.ts` keeps those numbers
executable so the reason cannot rot back into prose.

**No behaviour change.** The block stays `surfaces: CLI_ONLY`, runs on the same
three commands, and finds the same things. One latent defect is corrected
alongside it: the runtime gate mapped the `seed` metadata type to a stack key
`seeds`, which no stack has and no rule reads (seeds live on `data`). Nothing
declares `seed` in `runtimeTypes` today, so the correction is inert now — it
stops the gate from silently judging an empty collection for whoever declares it
first.
