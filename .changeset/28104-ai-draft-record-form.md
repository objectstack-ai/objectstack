---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(app-shell,components): "Open the full form" on an AI chat record card opens the New form with the values in router state, marked 「AI 建议」 until edited

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`:** on a create card from the AI chat (cloud#3565), "Open the full form" used to put every card value in the New page's query string, so a lead's name, phone number and e-mail address sat in the address bar, the browser history and any link copied from it. The values now travel in the router state of that one navigation (`utils/recordFormAiDraft.ts`), with their types kept, and the URL is the bare `/new` path. `RecordFormPage` reads them as create values in create mode only, under any query-string prefill, which still wins per field (a related-list "+ New" names its parent on purpose), and over the form view's `defaults`. When the page opens on such a draft it shows one notice above the form saying the record is not saved until the person checks it and saves. Nothing submits on its own. Router state belongs to the tab's history entry: reloading or going Back to that entry reopens the draft, while a copied link, a new tab or another device opens an empty form. The query-string helper `recordFormPrefill.ts`, which only this button used, is removed.
- **`@object-ui/components`:** new host slot `SuggestedFieldsContext` (a set of field names, default `undefined`). A `form` renderer under it marks each named field "AI suggestion" inside the field's description, so the control's `aria-describedby` announces it, while the field still holds its opening value. The person's first edit takes the mark away. It is not metadata: no form or field key sets it, and with no provider nothing changes.
- **`@object-ui/i18n`:** `form.aiSuggested` and `form.aiDraftNotice` in all eleven locale packs.
