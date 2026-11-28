---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ai` teaches knowledge sources over business objects, not only a document library

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai` § Knowledge Sources (RAG) gains three rules, one example each:

- **Long free text only.** `content` lists prose fields (an article body, a ticket's `description`, a note) with their title or subject line. Numbers, dates, statuses and the names of people or accounts stay out, and counts and filters go to the record tools (`aggregate_records`, or `aggregate_data` in the in-app assistant).
- **One source per corpus.** A skill's `instructions` say which source to pass in `sourceIds`, the argument of `search_knowledge`; omitted, every exposed source is scanned.
- **Attachment text goes through a field.** A `file` field in `content` adds no file text: write the extracted text to a `textarea` field and list that field.

No behaviour changes.
