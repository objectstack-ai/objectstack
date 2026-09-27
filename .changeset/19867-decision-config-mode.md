---
"@objectstack/spec": minor
---

`DecisionConfigSchema` declares an optional `mode: 'exclusive' | 'inclusive'` — the contract half of the #15429 ruling. The author of a `decision` node that routes on its out-edges can now declare whether it takes only the first out-edge whose condition holds or every one of them — with taking every one as the value that must be written down, the way BPMN separates the exclusive gateway from the inclusive one and n8n's Switch keeps "send to all matching outputs" behind an off-by-default toggle (#19867).

Clause-②: yes (widening) — one new OPTIONAL key on a published, strict node-config schema, so the set of accepted configs grows. Nothing previously accepted is refused, no key is renamed or retired, and the parsed output of an existing config is unchanged (the key has no `.default()`).

- **`'exclusive'`** — only the first out-edge whose condition holds, in the order the edges are declared; this is what an omitted `mode` means. **`'inclusive'`** — every out-edge whose condition holds. Any other value is refused at `mode` with a prescription naming both members' meanings.
- **⚠️ Declared ahead of its enforcement, on purpose.** The ruling's split order lands this key first, then the engine semantics together with the `os migrate meta` conversion in one change, then the docs. Until that second step ships, nothing reads `mode`: an edge-branched decision still takes EVERY out-edge whose condition holds, whatever `mode` says. The key's own description says so, and the conversion that writes `mode: 'inclusive'` onto every decision relying on today's behaviour ships in the same change as the new traversal, so no flow changes behaviour silently.
- **A `conditions` list is unaffected**: it is ordered first-match on its own, and `mode` speaks about the out-edges.
- **Where it binds today**: `decision` config stays export-only (nothing parses it at run time), so the closed pair is enforced by `tsc`, by the published JSON Schema and by a direct parse — the same doors `conditions` has.
