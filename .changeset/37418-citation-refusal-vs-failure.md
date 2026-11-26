---
'@objectstack/service-record-context': patch
'@objectstack/spec': patch
---

feat(record-context): the citation verifier tells a refusal from a failure and reports failures to the host

Clause-②: yes (widening) — new optional third argument of the exported verifyRecordCitations and two new exported types; existing calls unchanged
Metadata-protocol: none

ADR-0160 D9 verifies an answer's citations once, so a citation lost to an outage is lost for good. `verifyRecordCitations` used to drop a citation the same way whether the verifying call was refused or failed.

- **A refusal** is a throw carrying an ADR-0112 `code` with a declared 4xx status (read as ADR-0112's reader reads it: `.status`, then `.statusCode`), the only shape `get_record_context` refuses with. Its citations are dropped and nothing is reported, as before.
- **Any other throw** (no code, a driver code with no status, a 5xx) is a failure. Its citations are still dropped, so the result stays fail-closed, and the failure goes to the new optional `onError(error, call)` option, once per verifying call, so the host can log or retry. A failed read of the served definition behind an HTML body is reported too; there only the tag-removed reading is lost. A callback that throws, or returns a promise that rejects, is ignored.
- A refused read and a missing record still give the host the same answer: dropped, not reported.
- New exported types `VerifyRecordCitationsOptions` and `VerifyingCall`. Existing two-argument calls are unchanged.
- Docs: the verifier says which list cap a producer gets (the first 20 read, where `RecordCitationsSchema` refuses 21) and that the tag-removed reading of an HTML body joins adjacent text, so it is not only stricter than matching as stored. `stripBodyTags` says it is not a sanitizer.
