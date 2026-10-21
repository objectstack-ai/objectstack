---
'@objectstack/objectql': minor
---

feat(objectql): the engine composes a `ReadableIds` leaf that sits inside a composed read scope — the nested master chain (ADR-0139 D6 as amended)

Clause-②: no

**Before.** The executor boundary composed every `ReadableIds` leaf in a read's own `where` with the parent's read scope, and handed the driver that scope as answered. A scope that itself carried a leaf — a parent whose read scope is derived from ITS master, `{ master_fk: { $in: ReadableIds.of(G) } }`, the shape a two-level `controlled_by_parent` chain takes once its scope is spelled as a leaf — reached the driver uncomposed inside the parent's subquery, and the driver refused it, `INTERNAL_ERROR` / 500 (measured on driver-sql).

**Now.** Every leaf a composed scope carries is composed the same way, before the leaf that encloses it — the same five steps, the same caller context at every level (a delegated context included), recursively. The driver receives one composed leaf whose scope holds composed leaves and compiles one statement with the subqueries nested; a two-level chain serves exactly the rows today's id-list pre-scan serves, for a direct and for a delegated caller (measured on the real stack: `find` and `count` agree, one statement per read). Each parent is asked once per read, at whichever level it first appears. The closed doors hold at every level: `canReadObject` false, the deny sentinel, a throw on either half, or a parent the registry does not hold answer `$in: []` inside the composed scope. Refused by name, `INTERNAL_ERROR` / 500, before any driver is asked: D5's two classes at a nested level (a middleware-gated or federated master), a nested leaf outside a `$in` comparand or a composed leaf the engine did not compose inside a scope, a chain that returns to a parent already on its branch, and a chain deeper than 8 scopes (the same cut as the `controlled_by_parent` derivation's).

**What a reader sees.** No shipped security service answers a read scope carrying a leaf yet — `controlled_by_parent`'s scope is still the pre-resolved id list (ADR-0055 §2 mechanism (b)) until the plugin-security switch lands on its own card — so every shipped read is served as before. The six consumers' leaves compose exactly as they did: a scope with no leaf is composed by reference, one level asked.

**Unchanged.** `controlled_by_parent`'s own read scope and the id-list pre-scan, ADR-0055, every consumer's probe routing, and the drivers' compilation of the composed leaf (driver-sql and driver-memory already compile a scope that holds a composed leaf, through their own filter path).
