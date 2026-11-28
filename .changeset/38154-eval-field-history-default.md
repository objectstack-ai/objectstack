---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-project` change-history eval no longer expects an answer that sets `trackHistory` for field history

Clause-②: no
Metadata-protocol: none

`skills/objectstack-project/evals/project-process.json`, eval 9 (users need to see who changed which field and when): the expected answer said it "sets `trackHistory` where field-level history is wanted". A changed field's old and new values already show on the record activity timeline by default, and `fieldHistory` is their switch; a field's `trackHistory` only opts a media or structured-JSON type in, and the object's `enable.trackHistory` opens the audit ledger's view, not the values. The expected answer now leaves `activities` on, where the values show by default (`fieldHistory`), and points the users at the timeline. The prompt and the assertions are unchanged.
