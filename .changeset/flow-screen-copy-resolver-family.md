---
"@objectstack/spec": minor
---

**i18n:** the screen-flow copy vocabulary gains its resolver family — `translateFlow`, `resolveFlowScreenTitle`, and the `FLOW_SCREEN_COPY_KEYS` / `FLOW_SCREEN_FIELD_COPY_KEYS` shared key lists (#7646 recommendation B, the spec half of #11287).

#7763 declared `TranslationData.flows` (`flows.<flow_name>.label`, `.screens.<node_id>.title`, `.screens.<node_id>.fields.<field_name>.{label,placeholder}`) and deliberately left the resolver half unwritten because another change was in flight on `i18n-resolver.ts`. This lands that half in `packages/spec/src/system/i18n-resolver.ts`, mirroring the page family's conventions:

- `translateFlow(flow, bundle, opts)` — the metadata-document overlay: translates the flow's own `label` and, for every `type: 'screen'` node with an id, the screen heading (`config.title` — written even when the author relied on the node-label fallback, since the executor builds the wire title as `config.title ?? node.label`) and per-field `label` / `placeholder`, key by key across the locale chain with the authored source strings as fallback. Input not mutated; off-spec bundle keys the schema refuses (`description`, `help`) are ignored, never overlaid.
- `resolveFlowScreenTitle(bundle, flowName, screen, opts)` — the piecemeal half for a caller already holding a `ScreenSpec` (`nodeId` addressing, `title` literal fallback).
- `FLOW_SCREEN_COPY_KEYS` (`['title']`) and `FLOW_SCREEN_FIELD_COPY_KEYS` (`['label', 'placeholder']`) — the one list the resolver overlay and the CLI's skeleton extractor (downstream card) both import, pinned against `TranslationDataSchema` so neither can drift.
- Supporting shapes: `FlowLike`, `FlowNodeLike`, `FlowScreenLike`, `FlowScreenFieldLike`, `FlowScreenCopyKey`, `FlowScreenFieldCopyKey`.

Additive surface widening only — no existing shape changes meaning, and `translateFlow` is deliberately **not** registered in `translateMetadataDocument`'s dispatch table: that registration reaches the REST metadata boundary by itself (`TRANSLATABLE_METADATA_TYPES` drives `@objectstack/rest`), which would stand up a shipped reader of the `flows` group while its liveness ledger rows are `planned`. The runner application (server or client side), the CLI coverage bucket, and the ledger flip to `live` all ride the downstream cards of #11287.
