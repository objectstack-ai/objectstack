---
"@objectstack/plugin-sharing": minor
---

fix(plugin-sharing): one refused grant no longer aborts a sharing rule's reconcile pass — its stale-row revocations still run (#14754)

After #14484 `sys_record_share` is `tenant-scoped` in the #13491 ledger, so on a
walled install an organization-less system insert on it is refused loudly with
`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (#8844). `SharingService.grant`
resolves the organization on every path that can; a platform-global sharing
rule (`organization_id = null`, its sweep unscoped) materialising a grant onto
an organization-LESS record resolves none, and meets that refusal.

`SharingRuleService.reconcile` / `reconcileForRecord` had no per-grant catch, so
the refusal propagated and **that rule's pass aborted mid-loop**. Two things
were lost, and they are not equally serious:

- the remaining grants — recoverable, the next pass writes them;
- **the stale-row revocations of that pass** — not recoverable by waiting,
  because every subsequent pass meets the same organization-less record and
  dies in the same place. A stale over-grant of that rule therefore persisted
  indefinitely, and the record kept aborting the pass until it was repaired by
  hand. That is the security-relevant half.

Measured while pinning this, and it sharpens the point: the engine returns
organization-less rows **last** in a rule's criteria sweep (the driver's
NULL-org compatibility arm is appended to the scoped arm). So a refused grant
is nearly always one of the final attempts of a pass, and what an abort
destroyed was hardly ever "the remaining grants" — it was almost entirely the
revoke loop that runs after the whole upsert loop.

Both loops now attempt each grant individually. A refusal is logged with the
rule, object, record, recipient and the engine's own code, counted, and the
pass **continues** — the remaining grants and, above all, the stale-row
revocations still run.

**The catch is deliberately narrow.** Only
`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` is absorbed; every other error
rethrows unchanged. A catch-all would swallow real defects and report a pass
that "completed" having written nothing. It would also silently retire a
reviewed decision: `record-share-organization-stamp.test.ts` deliberately pins
the abort on the OTHER error a reconcile pass can meet here — the scoped update
half answering `RECORD_NOT_FOUND` for a row stamped with a different
organization — which the 2026-09-02 contract review left standing on "loud
beats a wrong count". Those three pins are unchanged and still green.

**Why `minor` rather than `patch`.** The repair is a bug fix, but it reports
through a new key. `reconcile` / `reconcileForRecord` / `evaluateRule` /
`evaluateAllForRecord` now return `SharingRuleReconcilePassResult` — the spec's
`SharingRuleEvaluationResult` plus `grantsRefused: number` — and that type is
newly exported from the package index. Purely additive: the contract in
`@objectstack/spec` is untouched, its six declared fields are unchanged, and a
consumer typed against `ISharingRuleService` keeps compiling as it did. Same
shape as `fix(runtime): tell an action handler when its caller-scope record load
was refused` (#14143), which shipped `minor` for the same reason.

`grantsRefused > 0` does **not** mean the pass failed. It means the pass met a
record it cannot grant on and carried on — which is the whole point.

**Wire surface — declared, not lifted.** `grantsRefused` reaches the wire.
`POST /api/v1/sharing/rules/:idOrName/evaluate` is a ledgered **SDK** route —
`packages/rest/src/rest-route-ledger.ts:390`, the row carrying
`disposition: 'sdk'` and `client: 'shares.rules.evaluate'` — and its REST handler
passes the service return value through **unfiltered**
(`packages/rest/src/rest-server.ts:11108`–`:11109`:
`const result = await svc.evaluateRule(req.params.idOrName, context ?? {})`
followed by `res.json(result)`). So the seventh key is on the response body every
caller of that route already receives. The SDK method declares
`SharingRuleEvaluationResult` as its resolved type
(`packages/client/src/index.ts:4766`, unwrapped at `:4771` through
`unwrapResponse` parameterised on that same type), and that type is the spec's
six-field contract — so the **declared client type cannot name the seventh key**.
That is a client-type **lag**, not a contract break: the key is additive on the
wire, every declared field is unchanged, and a consumer typed against
`SharingRuleEvaluationResult` keeps compiling exactly as before. Lifting the type
is not this PR's to do — `SharingRuleEvaluationResult` lives in
`@objectstack/spec`, a `domain:spec` single-owner file — so the lag is declared
here and tracked as the follow-up #14969, which lifts `grantsRefused?: number`
(optional) into `SharingRuleEvaluationResult`.
