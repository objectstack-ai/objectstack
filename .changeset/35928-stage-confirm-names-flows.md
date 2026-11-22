---
'@object-ui/plugin-detail': patch
'@object-ui/plugin-grid': patch
'@object-ui/fields': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(console): a stage confirm names the flows the move would start, in the list cell and on the record page

Clause-②: yes (widening) — `@object-ui/plugin-detail` adds the exports `useRecordUpdateStarts`, `StageChangeStarts`, `RECORD_UPDATE_STARTS_PATH` and the type `RecordUpdateStartsAsk`; `@object-ui/fields`' `RequiredFieldsDialog` takes an optional `notice`; `@object-ui/i18n` adds the export `activeFlowsBundle` (with the types `FlowsTranslation` and `TranslationResourceReader`, moved from `@object-ui/app-shell`'s internal `utils/flowsBundle`) and two keys to every pack: `detail.stageChangeStartsHeading`, `detail.stageChangeStartsApproval`. `@object-ui/plugin-grid`'s `StateChangeConfirm` gains an optional `ask`. Nothing existing is removed or re-typed.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the console's stage confirms; `content/docs/frontend/plugins/plugin-grid.mdx` names the list in this change.

When a stage move would start a flow, its confirm now says so (objectstack#35928, ruling record 7073655354):

- The list cell's state-machine confirm and the record page's stage confirm (the path's press and the header's stage menu) keep their sentence and add, under it, 「保存后将启动以下流程：」 ("Saving this change starts these flows:") and each flow by its label in the reader's language. A flow that starts an approval is marked 「发起审批」 ("starts an approval").
- Both confirms ask one read, `POST /api/v1/automation/_record-starts`, through one shared hook, so the two surfaces cannot disagree. The server decides which flows start; nothing is judged in the browser.
- A move that starts nothing shows no list, and a read that fails or is refused leaves the confirm exactly as it was.
- A flow label is translated as the flow runner translates it: the app's `flows` translations, read through `activeFlowsBundle`, which now lives in `@object-ui/i18n` so the confirms' packages can read it; the console's flow runner and designer import it from there.
