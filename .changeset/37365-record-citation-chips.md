---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(chatbot): an answer draws its verified record citations as chips, and a chip opens the record at the cited section

Clause-②: yes (a new reserved URL parameter `section`)
Metadata-protocol: none

An assistant answer that rests on records now draws the citations the platform verified when the answer was produced (ADR-0160 D9): the message's `data-record-citations` part, read through `@objectstack/spec/ai`'s `RecordCitationsSchema`, becomes one chip per citation beside the "How this was computed" block, each showing the quoted passage (`extractRecordCitations` in `@object-ui/plugin-chatbot`, `RecordCitations`). The list is drawn as it was persisted and is never verified again on display. A part the schema refuses draws nothing.

A chip calls the chat's `onOpenRecord` with the citation's `object` and `id` (the context pack's root record, also when the passage came from a related-list row) and its `anchor`; `onOpenRecord`'s argument gains an optional `anchor`. The console's assistant (the `/ai` page and the dock) opens `/apps/APP/OBJECT/record/ID?section=ANCHOR`.

`section` is a new reserved console URL parameter (`RECORD_SECTION_PARAM`, listed in `RESERVED_URL_PARAMS`). The record page reads it: the spec's `headingsOf` runs on each long-text field of the record (`markdown`, `html`, `richtext`, `textarea`), the first field whose outline issues the anchor is the body, and its heading is scrolled to and marked. A `textarea` body, or a heading the field does not draw, opens at the field; an anchor no heading issues any more opens the record at its top. A record detail row now carries `data-detail-field` with the field's name, which is how the page finds the field.

The record-link grammar in answers is unchanged: a fragment or a query string is still refused.
