---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): customize a read-only base's flow into its pair under the flow's own name, with one ledger switch, the override badge and "Restore package original"

Clause-②: no
Metadata-protocol: none

On a read-only base, Studio's Automations pillar now customizes a flow the way the Interfaces pillar customizes a view, a dashboard or a report (ADR-0146 D9 items 1 to 3, D2, D4).

- **Customize this flow.** The flow's header offers Customize, with the same control, the same ensure door (`POST /api/v1/packages/:id/ensure-customization`) and the same disabled reasons as the other customizable types. A walled tenant admin sees it disabled. Pressing it only unlocks the flow's editors. Nothing is written until an edit is saved.
- **The first saved edit** asks the ensure door once and writes the flow's draft into the package that answer names, under the flow's own name. The body is the served flow without its `_` keys, declaring `overrides: { package, basedOn }`. The designer then edits that draft. The rest of the package stays read-only.
- **One switch.** The open override keeps the activation-ledger switch on the flow's name. No definition switch is drawn for it, and Studio never writes the override's `status` to mean on or off.
- **The badge.** The header carries the override badge, read from the served declaration (the pair's draft, else the layered read's `overlay`).
- **Restore package original.** The flow's menu offers it for an override. Whether the flow is overridden is read from the declared override's own row, never from the served envelope's `deletable`, which follows the base's seal. The confirmation says the base's flow runs again under the same switch. Confirming deletes the pair's draft and then the pair's row, and the base's flow reads back. Delete flow stays on a writable package's own flow.
- **Refusals.** A refused save into the pair, and a refused publish of it, read as the server sent them.
- **New string.** `@object-ui/i18n`'s studio namespace gains `engine.studio.customize.restoreFlowBody` in `en` and `zh`. The other languages fall back to `en`, as the whole namespace does.
