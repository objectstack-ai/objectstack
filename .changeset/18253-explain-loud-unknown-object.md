---
"@objectstack/plugin-security": minor
"@objectstack/rest": minor
---

`security explain` refuses an object name that does not exist instead of reporting `denies` — a typo is no longer indistinguishable from a permission decision (#18253).

`GET/POST /api/v1/security/explain?object=leave_requst` used to walk all nine layers for a name nobody declared and answer `200` with `allowed: false` and `object_crud: 'denies'` — the byte-identical pair a **real** denial answers. Only the layer prose differed (#10401/#10424), and no client branches on prose, so the tool an administrator opens to ask "why can this person see this record" answered confidently about a record that does not exist.

It now answers `404` with `error.code: 'OBJECT_NOT_FOUND'`.

- **The engine decides, the door maps.** `explainAccess` throws `ExplainObjectNotFoundError` (plugin-security `errors.ts`), so every caller of `ISecurityService.explain` gets the refusal, not only the HTTP one; the REST route turns it into the status. A judgement made at the door would have been loud in one caller and silent in the other.
- **Nothing was newly minted.** `OBJECT_NOT_FOUND` at 404 is what this platform already answers for an unregistered object name (`mapDataError`, `packages/rest/src/error-response.ts`) and is a `StandardErrorCode` member, so no ledger row and no `packages/spec` change carries it. The body is emitted through the `/security/explain` family's one refusal emitter (#8073), so it is the ADR-0112 D5 envelope by construction.
- ⚠️ **Only one of the three unresolved causes moved.** An `unpublished_draft` declaration EXISTS (its remedy is "publish it") and a `metadata_unavailable` read did not answer, so both keep today's `denies` explanation — asserting absence there would state as fact the half the condition made unknowable.
- **Callers that branch on the verdict.** A client that treated `allowed: false` as "denied" for a misspelled object now meets a `404` refusal instead of a `200` decision. That is the point of the change, and it is the only wire movement: a resolvable object's report is byte-identical.
