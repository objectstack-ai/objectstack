---
'@objectstack/metadata-protocol': minor
---

**BREAKING** fix(metadata)!: a flow whose loop, parallel or try_catch region is malformed is refused at publish, and its draft read says so, instead of publishing and then never registering

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no published skill teaches that a malformed region publishes; the automation skill's region rules (one entry, one exit, acyclic) stay true, and the publish door now refuses a region that breaks them earlier, in the engine's words.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The publish doors now refuse a flow body whose region the automation engine already refused to register, with the engine's own sentence, so a published body that could never run has nothing a migration could rewrite it to: the author's fix is the one the refusal names. -->

**BREAKING** accept-set narrowing at the runtime authoring gate (`@objectstack/metadata-protocol`), which the metadata draft read and every publish door run (`PUT /api/v1/meta/:type/:name` live, `POST …/publish`, `POST /api/v1/packages/:id/publish-drafts`).

- **Before.** A flow whose ADR-0031 region was malformed (a `loop` body, a `parallel` branch or a `try_catch` try or catch region, at any depth, with no single entry or exit node, a cycle inside it, a shape its region schema refuses, or a `parallel` block with fewer than two branches) saved as a draft, its draft read answered `_diagnostics: { valid: true }`, and it published (`outcome: 'published'`). The automation engine then refused to register it ("loop 'lp' body: region has no entry node …; region contains a cycle (region bodies must be acyclic)"), so the flow never ran, and only the by-name read's `registration` and a boot-log warning said why.
- **Now.** The draft still saves (drafts are never gated). Its read answers `valid: false` with an error coded `flow-region-malformed` on the container node whose region is at fault (`nodes.N`, or the nested path such as `nodes.1.config.try.nodes.0`), and every publish door refuses it `422 INVALID_METADATA` with that finding; a package publish refuses the batch (`outcome: 'refused'`). The message is the engine's registration refusal, word for word.
- **One judge.** The gate calls `validateControlFlow` (`@objectstack/spec/automation`), the function the engine's registration calls, on the body parsed through `FlowSchema` as the engine parses it. A body the flow schema refuses is reported by the schema, as before.
- **Unchanged.** A flow whose regions the engine accepts publishes and registers, as before. `os validate` and `os build` do not run this check yet.

**The remedy.** None for a flow that registers today: it publishes exactly as before. A flow this now refuses was already refused by the engine at registration and never ran; the refusal names the region and what is wrong with it. Give the region one entry node and one exit node with no cycle inside it, and give a `parallel` block at least two branches. A stored flow published before this change is re-registered exactly as before (still refused by the engine).
