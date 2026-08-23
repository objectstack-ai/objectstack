---
"@objectstack/objectql": patch
---

Index short name → FQN in `SchemaRegistry` so name lookups stop scanning the
whole registry (#10945).

`SchemaRegistry.resolveObjectKey` answered the short-name direction by walking
**every** key of `objectContributors` and calling `parseFQN` on each. It is
reached from seven call sites — `getObject` among them — so a kernel boot that
registers N objects and resolves O(N) names did O(N²) string work, with
`parseFQN` the largest non-database entry in the CPU profile.

The consequence was a silence rather than a failure: boot got slower purely by
an environment accumulating metadata, and once bootstrap outgrew the request
waiter every request answered `kernel_warming` and the environment could never
be opened — no error anywhere.

`resolveObjectKey` now reads a short-name → FQN index `Map` maintained beside
`objectContributors`. Both containers are mutated only through two private
choke points, so they cannot drift apart: a caller cannot add a contributor
list and forget the index half.

Resolution is deliberately unchanged. The index array holds the same members in
the same order as the list the scan built, so an ambiguous short name still
resolves to the **first** key registered under it, the ambiguity warning still
names every match, and the legacy `<ns>__<name>` fallback still works. That
equivalence is pinned against the old loop itself, over every registration
order, rather than against a hand-written expectation.

Measured on the same container, resolving one name per registered object:

| registry | 32,000 lookups over 4,000 objects | scaling ratio at 8× input |
|---|---|---|
| full-registry scan | 4,888 ms | 62.5× (quadratic) |
| short-name index | 2.3 ms | 5.7× |
