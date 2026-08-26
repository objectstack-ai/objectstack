---
"@objectstack/cli": patch
---

fix(cli): the startup banner names a contested flow name and says which definition is armed (#12028)

`os dev` / `os start` print an automation summary that reads binding STATE off the
live engine, because a flow that failed to arm emits no log line to go looking for
and the boot-quiet stdout window swallows the engine's own `warn` narration. That
summary was silent about the one failure it could not express as a count.

The engine's flow map is keyed by BARE name. When a packaged flow and a
runtime-authored `sys_metadata` overlay both claim one name, ADR-0005 precedence
arms one and the loser is not in the map — so it is not in `listFlows()`, not in
`getFlowRuntimeStates()`'s rows, and therefore not in any number the banner
prints. `3 flow(s), 3 bound to triggers` was a true sentence about a set that did
not contain the definition the operator had just edited, and nothing on the banner
said otherwise. #11997 gave the engine the receipt (`getShadowedFlows()`, plus
`armedFrom` / `shadowed` on each runtime-state row) and the automation plugin
warns from it at `kernel:bootstrapped` — but that is a `logger.warn`, which is
exactly the channel this banner exists to work around.

`collectAutomationSummary` now reads that receipt through a probe feature-detected
exactly like the `getTriggerBindingAudit` one beside it, and the banner prints one
line per contested name carrying all three facts an operator needs:

```
  ⚠ flow 'send-welcome' is claimed by 2 definitions — a runtime-authored row
    (sys_metadata) is ARMED, 1 shadowed (ADR-0005 overlay precedence; only the
    armed definition dispatches)
```

Naming which body is armed is the point: a line reporting only the count tells an
admin something is wrong and withholds the answer they are standing there to get.

Silent on every healthy boot — no contested name, no line. This banner is read on
every start, and a warning that also fires when nothing is wrong is one readers
learn to skip. Both directions are pinned on what the banner RENDERS, absence
included.
