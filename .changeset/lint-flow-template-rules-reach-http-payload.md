---
"@objectstack/lint": patch
---

`flow-double-brace-interpolation` and `flow-bare-dollar-reference` now read an `http` node's request payload. Both rules were blind to the whole of `config.body` on every node type — the one key where an uninterpolated token has an outbound consequence.

The recursive template scan in `lint-flow-patterns.ts` read a region-stripped view of each node's config, and it built that view from the FLAT UNION of every config key that holds a region on *any* node type (`body`, `try`, `catch`, `branches`) rather than from the slots the node in hand actually owns. `body` is `loop`'s region slot **and** the canonical request-payload key on an `http` node, so `config.body` was deleted from every node's view before the scan ever read it.

That made the two rules silent exactly where they matter most: `http-nodes.ts` interpolates the raw config wholesale, so a double-brace `{{ record.title }}` or a bare `$source.id` written in a payload is never interpolated and ships to the endpoint as literal text. Measured before this change, an `http` node whose `body` carried either token shape — at the top level or nested inside a `try_catch` region — produced zero findings from either rule.

- **The call site passes its own slots.** `stripRegions(node.config, ownRegionKeys(node.type))`. The remedy was already written in `stripRegions`' own docblock ("Pass the OWNING node's slots, not the flat union") and the sibling call site in `flow-walk.ts` already followed it; this one did not.
- **The trapping default is gone.** `stripRegions`' `regionKeys` parameter is now REQUIRED. The flat union survived as a default only to bound an earlier change, and the cost of leaving it was this defect: the shorter call compiled and quietly asked a different question. A caller that has not decided which set it means now fails to compile instead.
- **The double-count direction is unchanged and pinned.** A token inside a `loop` body is still reported exactly ONCE, against the node that carries it and not also against the container — the reason the strip exists, and the direction that breaks if a repair over-corrects to stripping nothing.

Both rules keep their existing severity. New findings appear only where a `{{ }}` or bare `$ref.field` sits in a previously-hidden key; measured across `examples/app-showcase`, `app-crm` and `app-todo` (34 flows, `http` payloads inside a `parallel` branch and a `try_catch` try among them), the count is unchanged at zero — those payloads use correct single-brace tokens.
