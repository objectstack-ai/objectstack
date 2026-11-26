---
'@objectstack/spec': minor
'@objectstack/service-record-context': minor
---

feat(ai): the record citation shape enters spec, with the verifier that checks a citation's quote as the asking user (ADR-0160 D9)

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up #37177

An AI answer about a record may carry citations: the passage of the record it rests on.

- **`@objectstack/spec/ai`**: `RecordCitationSchema` is `{ object, id, context?, anchor?, quote }`, closed (an unknown key is refused), with `quote` required and non-empty. `RecordCitationsSchema` is a list of at most `RECORD_CITATIONS_MAX` (20). `RECORD_CITATIONS_PART_TYPE` (`data-record-citations`) names the UI-message data part a verified list rides. `headingsOf` and `stripBodyTags` (`record-body-anchor.ts`) derive a body's headings and anchors, so the server and a surface that opens a record at a cited anchor derive the same anchor.
- **`@objectstack/service-record-context`**: `verifyRecordCitations(citations, door)` returns the citations that survive. For each distinct `(object, id, context, anchor)` it calls `get_record_context` once, through the door bound to the asking user, and keeps a citation only when its `quote` is found in that answer's data member: a field or related-list cell `value` (when it is a string) or `display`, or the body `text` (an `html`/`richtext` body also with its tags removed). Whitespace runs collapse; case and every other character must agree. Notes, the framing sentence and labels are never matched. A refused call (a pack that does not exist, several packs and no `context`, an anchor that does not resolve, a record the caller cannot read) drops its citations. It never throws for a citation, and it reads at most the first 20 entries.

Nothing produces or draws citations yet: the producer persists the verified list with the message, and surfaces draw it without re-verifying.
