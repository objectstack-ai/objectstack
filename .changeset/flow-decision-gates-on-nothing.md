---
"@objectstack/lint": patch
---

`flow-decision-unconditional-branch` now reports the decision that gates on nothing — the shape the rule used to skip.

A `decision` whose out-edges carry no `condition` and no `isDefault`, and whose node declares no `config.conditions[]`, selects no branch at all: the automation engine's own decision executor reports no branch when `conditions[]` is empty, so traversal considers every out-edge and each successor runs on every pass. The gateway is decoration. The rule could not see that shape, because it was framed as "an unconditional edge undercuts a guarded one" and read zero guarded edges as nothing to undercut — so the strictly worse gateway was the one case that stayed silent, and it is the harder one to notice in review, because the node still says `type: 'decision'`.

Same rule id, same `warning` tier, with its own message: it names the out-edges that run unconditionally and offers the three fixes (a `condition` per branch plus `isDefault: true` on the fallback, a `config.conditions[]` whose `label` matches an out-edge, or dropping `type: 'decision'` for the node the gateway already behaves as). The mixed shape — one guarded out-edge beside an unconditional one — keeps its existing wording and its single finding.

Decisions that do declare their routing stay silent, including the two that are easiest to catch by mistake: an ordinary gateway with guarded edges, and a decision that routes by `config.conditions[]` labels alone with bare out-edges. A decision declaring a label no out-edge claims remains the gating `flow-branch-label-unmatched` on its own, with no second finding piled on the same node.
