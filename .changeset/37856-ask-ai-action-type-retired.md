---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/service-datasource': patch
'@object-ui/core': minor
'@object-ui/react': minor
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': minor
---

feat(spec)!: retire the `ask_ai` action type — the shell's 「问 AI」 entry is the one way into the assistant

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37857

<!-- adr-0087: registered action-type-ask-ai-removed, ui-action-type-ask-ai-retired -->

**BREAKING** enum value removal on `ActionType` (`@objectstack/spec/ui`), ADR-0160 D7 as its seventh amendment rules. `ask_ai` was published only on the 19 prerelease line (`19.0.0-next.0`) and in no stable release; it leaves before 19.0.0 with no compatibility shim. A button per page is a second entry to the assistant, and the shell's 「问 AI」 entry in the page header already opens on the record in view. The accepted cost: a list row has no ask-AI action of its own.

| FROM | TO |
|:--|:--|
| `{ name: 'ask_about_case', type: 'ask_ai', locations: ['record_header'] }` | nothing: delete the action and every reference to it; the shell's 「问 AI」 entry opens on the record |
| `{ type: 'action:button', properties: { actionType: 'ask_ai' } }` | nothing: delete the row |

The one-line fix: delete each `ask_ai` action and every name that points at it (a page header's `actions`, a list view's `rowActions` / `bulkActions`, a related list's `actions`, a quick-actions list, a record alert's `actionName`, an app navigation entry). `os migrate meta --from 18` lists the edits; `--write` deletes an `ask_ai` action that nothing in the stack names and every inline row and container member that spells it, and leaves a named one, with its references, for you to delete by hand.

- **`@objectstack/spec`**: every slot that takes an action type refuses `ask_ai` with one prescription: a declared or inline action's `type`, an `action:button` / `action:icon` row's `actionType`, an `action:group` / `action:menu` member's `type`, and a dashboard header action's `actionType`. The D2 conversion `action-type-ask-ai-removed` (retired from the load path) deletes, over sources, only what nothing names and, at rest (stored rows, built artifacts), every `ask_ai` action, row and member. The D3 entry `ui-action-type-ask-ai-retired` names what is done by hand. `applyConversionsToStoredItem` now answers `undefined` when the chain leaves no item of a row, which a stored `action` row of this type is; `ConversionContext` gains `atRest`. `ActionSchema`'s ask_ai refinements and the dashboard's record-less refusal leave with the type.
- **`@objectstack/metadata-protocol`**, **`@objectstack/metadata`**, **`@objectstack/core`**, **`@objectstack/service-datasource`**: a stored row the seam yields no item of is registered and served as nothing. The database loader still finds it by name, so `DELETE /api/v1/meta/action/<name>` removes it, and `migrateStoredMetadata` lists it `skipped` with that instruction instead of re-saving it.
- **`@objectstack/runtime`**: the action-execution branches for `ask_ai` are gone.
- **`@object-ui/core`**: `ActionRunner.setAssistantFocusHandler`, `ActionRunner.drawsAction`, `ActionRunner.bulkRefusal`, `isAskAiAction` and the `AssistantFocus` / `AssistantFocusHandler` types are removed; `ActionEngine` no longer filters undrawn actions or refuses a bulk run of one.
- **`@object-ui/react`**: `<ActionProvider onAskAi>` and `useDrawsAction()` are removed.
- **`@object-ui/components`**, **`@object-ui/plugin-grid`**, **`@object-ui/plugin-detail`**: the renderers drop their drawn-action gates.
- **`@object-ui/app-shell`**: `setChatFocus` and its `follow` option are removed; the conversation's record pin is set from the composer chip only. `useAskAiHandler`, `AiSurfaceState.focusServed` and the catalog `focus` lookup behind them leave with the type. This also closes #37827, the record page that dropped the shell's ask-AI handler: there is no handler left to drop.

Correction to two prerelease notes already published in `19.0.0-next.0` (`.changeset/pre/37142-ask-ai-action-type.md` and the `setChatFocus` line of `.changeset/pre/36999-conversation-focus.md`): the `ask_ai` action type and the `setChatFocus` setter they announce do not ship in 19.0.0. The in-composer record pin from #36999 stays.
