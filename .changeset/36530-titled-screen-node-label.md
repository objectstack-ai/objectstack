---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/i18n': minor
'@object-ui/components': minor
---

feat(i18n): a flow screen with its own heading gets a translatable step name, `flows.FLOW.nodes.NODE_ID.label`

Clause-②: yes (widening)
Metadata-protocol: added

A screen node that sets its own `config.title` has a heading and a separate canvas label. Until now only the heading could be translated (`flows.FLOW.screens.NODE_ID.title`), so the label stayed in the authoring language. The docs flow embed and the Studio flow designer both draw that label.

- **New key accepted.** `objectstack validate` now accepts `flows.FLOW.nodes.NODE_ID.label` over a screen whose `config.title` is a non-empty string. A screen with no `config.title` is still refused there and pointed at `screens.NODE_ID.title`, because its heading is its label and one string keeps one key. An `approval` node is still pointed at `approvals.NODE_ID.label`.
- **Docs embed.** The `type: flow` embed (`element:metadata_viewer`) names a titled screen by its heading, translated where the bundle has the heading. When the heading holds a `{{ }}` hole, which a drawing cannot fill, the embed now names the screen by the new key, and falls back to the authored label only if the key is missing.
- **Studio designer.** The canvas draws a titled screen's label from the new key.
- **Untitled screen with a hole.** If a translated `screens.NODE_ID.title` contains a `{{ }}` hole, the embed and the canvas now draw the authored label rather than the raw template.
- **Coverage.** `os lint`'s i18n coverage and `os i18n extract` ask for the new key on a top-level screen whose authored heading holds a `{{ }}` hole. These are the screens the embed draws by their label.
- **One branch rule.** `@objectstack/spec/automation` exports `flowDecisionEdgeBranch`, `FlowDecisionEdgeBranch` and `FLOW_DECISION_DEFAULT_BRANCH_LABEL`. They decide which out-edges of a decision a drawing lists as branches. The docs embed's branch list and the i18n walk's folded branch targets both read them, so the two can no longer disagree.

Nothing to migrate. A bundle that does not use the new key keeps working.
