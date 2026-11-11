---
'@objectstack/skills': patch
---

docs(skills): the automation skill teaches that a `script` node's function resolves from the calling flow's package

Clause-②: no
Metadata-protocol: none

Silently-wrong item 3 of `skills/objectstack-automation/SKILL.md` now says how a `script` node's `config.function` is resolved since the node reads functions by package (ADR-0150 D3): from the calling flow's package, as `subflow`'s `flowName` is, with the platform's owner-less function in every flow's reach, and a `.custom` override reading as a package-less flow. Two packages that both ship `normalize_phone` each run their own (the boot still warns about the shared name). A flow holding none itself that has two holders in reach, or one only outside its `dependencies` closure, fails the step as a guard: `400 FLOW_FAILED` with `details.innerRefusal.code: 'RESOURCE_CONFLICT'` naming each holder, and `$error.code` in a `try_catch`. The fix is to declare the dependency, or rename.

Paid first by one same-file restatement: the item's `defineStack({ functions: { my_fn: (ctx) => … } })` example, whose shape the same item's `'helpdesk.aiTriageStub'` block still shows. The automation SKILL.md token-ratchet row rises by the measured remainder only, 6687 → 6852.
