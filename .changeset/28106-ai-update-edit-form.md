---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(app-shell,components): "Open the full form" on an AI chat update card opens the edit form with the proposed changes applied, before → after, marked 「AI 建议」 with a per-field revert; a record open in a list's drawer is sent to the chat as the record in view

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`:** on an update card from the AI chat (cloud#3565), "Open the full form" used to open the record's edit page on the stored record alone, so every change the card proposed had to be typed again. The card's proposed values now travel in the router state of that navigation, through the same carrier the create card uses (`utils/recordFormAiDraft.ts`), bound to the record they were proposed for, and nothing is added to the URL. `RecordFormPage` reads them in edit mode only, for that record only, hands them to the form, and shows the same one-line notice above it that nothing is saved until the person checks and saves. Nothing submits on its own. The console dock now also reads a list's record drawer (`?recordId=`): while a record is open in the drawer, the chat's `context.surface` names the object and that record, as it already did on the record page, so "change its phone to …" asked beside the drawer reaches the agent about that record.
- **`@object-ui/components`:** new host slot `SuggestedFieldChangesContext` (field name → proposed value, default `undefined`), the edit-form sibling of `SuggestedFieldsContext`. A `form` renderer under it applies each proposed value once, over the record it opens on, as an unsaved change: the form reads dirty, the discard guard hears it and Save writes it. While a field still holds the proposed value it shows the same "AI suggestion" mark, a "Was: …" line with the stored value it replaces, and a Revert button that puts the stored value back. A proposal for a field the form does not draw, or one that is read-only (by its config or by a `readonlyWhen` rule on the stored record) or disabled, is not applied. Each proposal is tried once per field, when the form first draws it, so on an edit wizard a later step's proposal lands on that step and a field the person reverted stays reverted across Next and Back. It is not metadata: no form or field key sets it, and with no provider nothing changes.
- **`@object-ui/i18n`:** `form.aiBefore`, `form.aiBeforeEmpty` and `form.aiRevert` in all eleven locale packs.
