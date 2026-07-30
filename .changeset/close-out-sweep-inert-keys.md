---
"@objectstack/spec": major
---

refactor(spec)!: the #3896 close-out sweep — fourteen inert authoring keys leave the surface

The enforce-or-remove worklist across the remaining metadata types, each key
tombstoned at its schema with the prescription (`retiredKey`) and stripped by
a protocol-17 conversion (`os migrate meta` rewrites sources):

- **action** `shortcut` / `bulkEnabled` — no keydown path ever dispatched a
  shortcut; the multi-select toolbar reads the view's `bulkActions`.
- **flow** `active` / `template`, node `outputSchema`, errorHandling
  `fallbackNodeId` — `active: false` never stopped a flow (`status` is the
  enforced lifecycle; the default even read as disabled while the engine
  treated unset as enabled); faults route via per-node fault edges.
- **view** list `responsive` / `performance`, form `defaultSort` / `aria` —
  no renderer read any of them. List `aria`/`data` stay live, and **form
  `data` survived the sweep**: the removal attempt broke the build —
  `defineForm` writes `data.provider='schema'` onto every metadata form —
  which re-verified the entry; its ledger verdict is corrected instead.
- **dashboard** `aria` / `performance`, widget `performance` (+ the orphaned
  `PerformanceConfigSchema`) — no renderer applied them; virtual scrolling is
  the live top-level `virtualScroll`.
- **agent** `knowledge` (+ `AIKnowledgeSchema`) — declaring sources/indexes
  never scoped retrieval: `search_knowledge` takes `sourceIds` from the LLM's
  tool-call arguments. The protocol-17 `topics`→`sources` rename is absorbed
  into the removal pre-release.
- **skill** `triggerPhrases` — phrases were never matched; activation is
  `triggerConditions` ∩ the agent's `skills[]` allowlist.

Docs-shaped annotation fields (`hook.label`/`description`, `flow.description`)
are deliberately KEPT and so noted in the ledger — they document intent for
the next reader and are exempt from enforce-or-remove. The stale report
`aria`/`performance` ledger entries (schema already clean) are deleted as
hygiene.
