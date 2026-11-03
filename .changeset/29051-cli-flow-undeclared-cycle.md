---
'@objectstack/cli': patch
---

**BREAKING** fix(cli)!: `os validate` and `os build` refuse a flow whose top-level graph closes a cycle with no `type: 'back'` edge, as the automation engine refuses it at registration

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-automation/references/state-machines-and-approvals.md` already teaches that a cycle-closing edge MUST be typed `'back'` and that an unmarked cycle is refused; that stays true, and the CLI now refuses the same flow before it ships.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The build verbs now refuse a flow body the automation engine already refused to register and the publish doors already refuse, with the engine's own sentence, so there is nothing a migration could rewrite: the author's fix is the one the refusal names. -->

**BREAKING** accept-set narrowing at the CLI's author-time doors (`@objectstack/cli`).

- **Before.** A flow whose top-level graph had a cycle with no edge typed `back` (ADR-0044), such as `start → push → check → revise → push`, passed `os validate` and `os build` with exit 0. The engine then refused to register it at boot ("Flow contains a cycle: …"), logged a warning, and ran without it.
- **Now.** Both commands refuse it, exit 1, and `os build` writes no artifact. The row is `VALIDATION_ERROR`, located at the flow (`flows[N]`, or `packages[K].manifest.flows[N]` in an assembled artifact), and its message is the engine's registration refusal, word for word. The judge is `findUndeclaredFlowCycle` from `@objectstack/metadata-core`, the one the engine's registration and the runtime publish gate call, so all three refuse exactly the same graphs. It is a CLI step, not an `@objectstack/lint` rule, since lint does not depend on metadata-core; the rule table runs first, so a flow with both a malformed region (`flow-region-shape-invalid`) and an undeclared cycle is refused for the region first, and for the cycle once the region is fixed (the engine names the cycle first).
- **Unchanged.** A cycle with any of its edges typed `back` validates and builds, as before. Cycles inside a `loop` / `parallel` / `try_catch` region are judged by the region check, as before.

**The remedy.** None for a flow that registers today. A flow this now refuses never ran: if the loop is intended, set `type: 'back'` on the cycle-closing edge (ADR-0044); otherwise remove or redirect that edge.
