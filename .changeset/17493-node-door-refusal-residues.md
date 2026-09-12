---
"@objectstack/spec": patch
---

docs(spec): the structural-condition ruling and the ADR-0087 entry both name the NODE slot (#17493)

Two places in `packages/spec` still described the world as it was before the
blank structural condition became a defect. Neither changes behaviour: this is
the notification half of a refusal that has already shipped.

**The ADR-0087 D3 entry `flow-edge-condition-evaluated-slot-source-required`
named only the edge key.** Its `surface` and `acceptanceCriteria` told a
consumer replaying the chain to sweep `edges[].condition` and nothing else —
so a deployment carrying a blank `config.condition` on a flow node was never
told to look, even though `AutomationEngine.registerFlow` refuses it since
#17322 and `objectstack validate` since #17495. Both fields now name both
structural slots, the node key's own locator
(the phrase the structural pass builds, e.g. `node 'gate' (start) condition`) is
stated beside the edge's `flows.N.edges.N.condition`, and the sweep carries the
warning that removing a `condition` from a `start` node opens the trigger gate
rather than preserving it. The entry's `id`, `replacement` and `reason` are
untouched, and no new entry is added: this is one decision reaching its second
slot, not a second decision.

**`structuralConditionRefusal`'s docblock stated a ruling that had become
false.** It admitted a whitespace-only string on the ground that such a
condition "is consistent on both sides and is ruled correct, not a defect" —
the ground #15807 removed at the edge door and #17322 ruled on. The admission
itself is unchanged and still correct, because this function answers the SHAPE
question only and the blank is refused beside it by the imported
evaluated-slot rule; what the docblock now records is which card removed the
ground, which door each refusal lives at, and why the two refusals are kept
distinct.

It also records, without answering, the question one slot over: the ledger
`predicate` slots (`config.conditions[].expression`,
`screen.fields[].visibleWhen`) still admit a whitespace-only string, pinned as
correct by #15572 on the same ground. Narrowing them re-judges that pin and
moves a published accept-set, so it is a ruling and stays open on #17493.
