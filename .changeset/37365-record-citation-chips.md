---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(chatbot): when an answer carries a verified record-citations part, the console draws it as chips, and a chip opens the record at the cited section

Clause-②: yes (a new reserved URL parameter `section`)
Metadata-protocol: none

When an assistant answer carries a `data-record-citations` part (ADR-0160 D9), the console draws it: the part, read through `@objectstack/spec/ai`'s `RecordCitationsSchema`, becomes one chip per citation beside the "How this was computed" block, each showing the quoted passage (`extractRecordCitations` in `@object-ui/plugin-chatbot`, `RecordCitations`). The chips draw the part as it arrives and verify nothing again on display. A part the schema refuses draws nothing. Nothing in this release emits the part yet, and a conversation reloaded from history does not redraw it yet: the chips appear on a live answer whose stream carries the part.

A chip calls the chat's `onOpenRecord` with the citation's `object` and `id` (the context pack's root record, also when the passage came from a related-list row) and its `anchor`; `onOpenRecord`'s argument gains an optional `anchor`. The console's assistant (the `/ai` page and the dock) opens `/apps/APP/OBJECT/record/ID?section=ANCHOR`.

`section` is a new reserved console URL parameter (`RECORD_SECTION_PARAM`, listed in `RESERVED_URL_PARAMS`). The record page reads it: the spec's `headingsOf` runs on each long-text field of the record (`markdown`, `html`, `richtext`, `textarea`), the first field whose outline issues the anchor is the body, and its heading is scrolled to and marked; opening another section moves the mark, and the same chip clicked again opens the section again. A `textarea` body, a heading the field does not draw, or a body that draws a different number of headings of that title than its outline lists, opens at the field; an anchor no heading issues any more opens the record at its top. A record detail row now carries `data-detail-field` with the field's name, which is how the page finds the field.

The record-link grammar in answers is unchanged: a fragment or a query string is still refused.
