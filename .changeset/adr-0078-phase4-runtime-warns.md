---
'@objectstack/objectql': minor
'@objectstack/plugin-webhooks': patch
---

ADR-0078 Phase 4, decided rather than deferred: the silent skips stop being silent at runtime. The registry — the one choke point every metadata door goes through — now emits a functional-completeness diagnostic at registration, and the webhook enqueuer's zero-trigger skip warns instead of returning `null` wordlessly.

**The Phase 4 ruling.** The phase had two halves, and they got opposite verdicts:

- **Generative rule sweep: rejected — not deferred.** A generator can enumerate candidates ("which optional keys might be load-bearing?") but cannot verify runtime skip sites, and a rule without its skip-site citation is a false prescription — this campaign shipped four of those and every one was caught by the verification pass a generator would skip. The route is structurally wrong; no amount of waiting produces the evidence that would fix it.
- **Registration-time diagnostics: built now.** The evidence was already in hand, not pending: #3896 (Setup authoring inserted `sys_sharing_rule` rows directly, bypassing the schema that "required" `criteria`) and cloud's `rowColor.mapping` (an `as never` cast bypassed tsc) prove that doors which skip Zod and lint are real. The author-time gate only protects metadata that passes through `os build` / `validate` / `lint`; `SchemaRegistry.registerObject` is where *every* door converges — declared stacks, plugin objects, `extend` contributions, `saveMetaItem`, raw `registerObject` calls.

**Same predicate, same rule ids, different posture.** The registry calls the same `checkFieldCompleteness` that `validate-functional-completeness` uses, so the boot log carries the *same rule ids* the lint reports (`field/summary-without-operations`, …) — an operator or an AI reading the log greps the id straight into the same docs and suppression story. But the registry **warns and never throws**: ADR-0078 §1's error severity means *the instance is dead*, not *the system is dead* — an inert field must not kill a boot that thousands of healthy objects share. Errors block at author time; the registry's job is to make sure the silence never survives to runtime unobserved.

One line per object with every finding aggregated (not per request — the hot path stays free; not per finding — a three-dead-field object is one greppable line). Follows `warnStrippedLegacyApiMethods` (#3543) exactly: module-level once-per-object dedup, injectable `warn`, pure observation that never mutates the schema.

**The webhook skip now names itself.** `auto-enqueuer.ts`'s `if (triggers.size === 0) return null` sat under a comment blessing the empty case as "a manual-only webhook" — a mode #3196 removed (no manual fire path exists). The skip now warns with the author-time rule id (`webhook/without-triggers`), and the comment tells the truth. Only *active* rows reach the parse (`where: { active: true }` — verified, not assumed), so a deliberately disabled webhook stays warning-free.

**Scope honesty:** field rules and the webhook rule get the runtime twin. `view/layout-without-binding` stays author-time-only — views don't register through this choke point and the renderer half of the evidence lives in objectui.

Tracked in #4544. This closes the ADR-0078 loop end to end: author-time error, runtime warning, one shared predicate deciding both.
