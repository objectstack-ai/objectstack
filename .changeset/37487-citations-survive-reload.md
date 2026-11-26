---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
---

fix(chatbot): an answer's record-citation chips are drawn again after a reload or when a conversation is reopened, and a navigation on the cited record no longer scrolls back to the cited heading

Clause-②: no
Metadata-protocol: none

The history rebuild of the `/ai` page, the console's browser-side message cache and the `useObjectChat` store rebuild kept only an answer's charts, so a persisted `data-record-citations` part was not drawn again after a reload. All three now keep the data parts named by one allow-list, `STORED_ANSWER_DATA_PARTS` (charts and record citations), written by `storedAnswerParts` and read back by `storedAnswerData`. The citations list comes back as it was persisted: it is read through the same `RecordCitationsSchema` parse as a live part, so a list the schema refuses still draws nothing, and nothing is verified again.

A record opened from a chip (`?section=ANCHOR`) scrolls to the cited heading once per click. A navigation that drops the history state, such as the command palette or a record form opened over the page and closed with Back, no longer counts as a new click, so the page stays where the reader scrolled it.
