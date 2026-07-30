---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

The `wait` executor reads its declared contract only; the loose `config` back door graduates into the conversion layer (#4045).

`wait` keeps its contract in `waitEventConfig` — a declared, `.describe()`-annotated
block on `FlowNodeSchema` that is in the authorable-field list, reaches the generated
reference, and is what the showcase actually authors. Its descriptor publishes no
`configSchema`, which is by design rather than the gap it first looks like.

The executor nevertheless also read six loose `config` keys behind `wec.X ?? loose.X`,
two of them (`duration`, `signal`) spellings the spec never declared anywhere. That is
the `notify.source` shape #4050 retired: a second de-facto contract announced only by a
code comment, so an author who wrote it got a flow that worked forever and was never
steered to the declared spelling (PD #12). Not hypothetical: the showcase's own
`wait_revision` node authored it (`config: { eventType: 'signal', signalName: … }`) and
moves to the declared block here.

- New ADR-0087 D2 conversion `flow-node-wait-event-config-lift` lifts
  `config.{eventType,timerDuration,duration,timeoutMs,signalName,signal}` onto the
  declared `waitEventConfig` block, in the executor's own `??` precedence — a declared
  value wins and its loose counterpart is left shadowed, exactly as `renameConfigKey`
  treats a shadowed alias.
- `eventType` is stamped `'timer'` whenever the lift would otherwise leave the block
  without one. This is load-bearing: the loader parses the **converted** flow
  (`applyConversionsToFlow` → `FlowSchema.parse`) and `waitEventConfig.eventType` is
  required once the block exists — so a stored flow carrying only
  `config: { duration: 'PT1M' }` would have gone from working to failing to load.
  `'timer'` is the exact default the executor applied to that shape.
- The executor's six `?? loose.*` fallbacks are deleted. The surviving `?? 'timer'` is
  not one: `waitEventConfig` is itself optional, and a wait node without one is a valid
  timer wait.

Verified at the real seam: the new executor tests author the legacy shape and go through
`registerFlow`, which is what applies the conversion, so they prove the graduation
end-to-end on a legacy source rather than only that the executor stopped looking. A
negative control pins the `eventType` default — deleting it from the converted output
makes `FlowSchema.parse` throw.

Two things this deliberately does **not** change, filed as #4158 rather than fixed in
passing: `waitEventConfig.timeoutMs` is declared as a timeout guard but read as a timer
duration, and `waitEventConfig.onTimeout` has zero readers anywhere — so `wait` has no
timeout implementation at all, while the showcase authors `onTimeout: 'continue'`.
Implementing or retracting that is a behaviour change, not a contract cleanup.
