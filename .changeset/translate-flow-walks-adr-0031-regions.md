---
'@objectstack/spec': patch
---

`translateFlow` overlays screen nodes inside ADR-0031 regions, at any depth

`translateFlow` (`system/i18n-resolver.ts`) read the flat `flow.nodes` array and
nothing else. But `FlowNode.config` carries ADR-0031 regions —
`loop.config.body`, `parallel.config.branches[].nodes`,
`try_catch.config.try`/`.catch` — each holding a full `nodes` array that nests
arbitrarily, and a `type: 'screen'` node inside one is a real screen: the
executor pauses on it and the client receives its `ScreenSpec.nodeId`.

So `flows.<name>.screens.<node_id>.{title,fields.*}` was authored for such a
node, parsed (the bundle schema is keyed by node id and knows nothing about
depth) and was then silently never applied. The wizard step rendered its
source-locale heading and field labels while its siblings one level up were
translated.

The descent now runs through `mapFlowNodeList`, a per-flow region-aware
copy-on-write walk shared with the ADR-0087 conversions' `mapFlowNodes`, which
reads `FLOW_REGION_SLOTS_BY_TYPE` — the single declaration of where a region
lives (`automation/region-slots.ts`). This resolver is therefore not a fifth
hand-rolled reader of that table; the fourth pass written against the flat
one-liner is the last one that had to be.

Reference identity is unchanged and is pinned: a node that resolves nothing
comes back as the same reference, every container `config` and region `nodes`
array on the way down is copied only when a descendant actually changed, and a
flow the bundle does not carry is returned as the same object.

⛔ No wiring changed. `translateFlow` is still deliberately absent from
`translateMetadataDocument`'s dispatch table and no liveness row moved — that
decision belongs to the downstream runner card, as its docblock records.
