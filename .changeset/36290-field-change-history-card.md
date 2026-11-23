---
'@object-ui/plugin-detail': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/types': patch
'@object-ui/i18n': patch
'@objectstack/spec': patch
---

feat(record-page): one field's change history, opened in place from the field or from a list cell's context menu

Clause-②: yes (widening) — three new `detail.*` language-pack keys in every locale `@object-ui/i18n` ships (`fieldHistory`, `fieldHistoryNone`, `fieldHistoryNoneRecent`); new exports from `@object-ui/plugin-detail` (`FieldHistoryButton`, `FieldHistoryCard`, `FieldHistoryPopover`, `useFieldHistory`, `useFieldHistoryOffered`, `fieldHistoryOffered`, the constants `FIELD_HISTORY_PAGE_SIZE`, `FIELD_HISTORY_SCAN_BATCH` and `FIELD_HISTORY_SCAN_BATCHES_PER_LOAD`, and their types); an optional `column` member on the context `data-table` hands a host's `renderRowContextMenu`; `FieldChangeItem` draws no label for `label: ''`; nothing is removed or renamed
Metadata-protocol: none

A reader can now see one field's past changes on one record without reading the whole activity stream.

- On the record page, each field of the object has a history button beside its value, shown on hover and focus like the copy button. In a list, right-clicking a cell of a field the object declares adds 「Change history」 to the row's menu. Both open the same small card in place. Neither is offered on a field whose old → new values are not recorded (`fieldHistory: false` on the field, `enable.fieldHistory: false` on the object, a credential field, or a media or JSON-like type that does not opt in), judged by the same `resolveFieldHistory` the audit writer keeps values by.
- The card lists only that field's changes: who, when, and old → new in the reader's words (an option by its label, an empty side as the pack's word for empty), newest first, ten at a time with 「Load more」.
- A field never changed reads 「No changes recorded」 with who created the record and when.
- The changes are the record's activity rows the server already serves, narrowed to the reader: a change of a field the reader may not read is never sent. A field the reader may not read offers no entry point at all. The full audit log is not read.
- The rows are read by record, newest first, fifty at a time, keeping those that changed the field; a query naming the change columns is refused for a reader withheld any field of the object, so the field is never part of the query. Opening the card reads at most four batches, and each 「Load more」 at most four more; when they hold no change of the field and older rows remain, the card reads 「No changes in the recent activity」 and offers 「Load more」 to read on.

`@objectstack/spec`: the authoring hint for the mistyped field key `tracked` now names what turns one field's change history on or off today (`fieldHistory: false`, `true` for a media or JSON field, `enable.fieldHistory: false` on the object), where it named `trackHistory: true`, which changes nothing for most field types. Wording only; `tracked` stays rejected.
