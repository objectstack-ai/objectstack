---
'@objectstack/cli': patch
---

`serve`: warn when the declared replica count exceeds the licensed node cap (#8504)

The 2026-08-13 `max_nodes` ruling requires a licensed overflow to refuse the excess,
run up to the paid limit, and **warn loudly**. The gate learned to express the first
two — `admitted` / `refused` / `capped` — but the only program that consults it, `os
serve`, called it zero-arg and typed the result with a hand-written
`{ allowed, reason }` cast. So the partial-cap verdict was unreachable *and* unread:
the gate could say "3 admitted, 2 refused" and nothing rendered it.

`serve` now passes the operator-declared `OS_CLUSTER_REPLICAS` into the gate and
emits an advisory on `capped`:

```
[cluster] licensed node cap exceeded: the licence admits 3 node(s), but
OS_CLUSTER_REPLICAS declares 5 — 2 beyond the cap.
[cluster] This cap is ADVISORY and is not enforced yet: nothing is refused, and all
5 replicas will still join the cluster.
[cluster] Reduce OS_CLUSTER_REPLICAS to 3, or raise the licensed node limit.
```

⚠️ The wording is deliberately advisory. Enforcement needs an atomic slot claim
across replicas and is tracked separately; until it lands **nothing is actually
refused** — every replica computes the same verdict at boot and none can tell whether
it is one of the admitted ones, so all of them join. A message claiming "2 replicas
refused" would be false in exactly the declared-vs-delivered way this warning exists
to close.

An outright `allowed: false` denial is untouched: it keeps reporting as a
single-node downgrade, and is deliberately not reported as a cap.
