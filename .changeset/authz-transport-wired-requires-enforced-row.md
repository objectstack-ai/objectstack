---
"@objectstack/dogfood": patch
---

test(qa): a wired realtime transport can no longer be signed off by the row that records the absence of authorization (#9083)

The ADR-0056 D10 authz conformance matrix carries a tripwire note promising
that wiring an end-user realtime transport reds CI "until this row is upgraded
with the enforcement site." The gate did not hold that out. `checkLedger`
requires an `enforcement` site only when `state === 'enforced'`, while a row's
`covers` keys classify a discovered surface **regardless of state** — so the
shortest path from red back to green was to append the tripwire key to the
`experimental` `realtime-delivery-authz` row, whose own summary records that
realtime fan-out has **NO** per-recipient authorization.

Measured on `origin/main` before the fix, both legs reproduced from the filing:
wiring `new EventSource('/api/v1/stream')` into `packages/client/src/realtime-api.ts`
fails 2 of 15 cases as `UNCLASSIFIED surface — … realtime:client/realtime-api.ts:transport(TRANSPORT-WIRED)`;
appending that one key to the experimental row — with the transport still wired
and zero authorization written — returns 15/15 green. The `removed` state was
measured to admit the identical exit, so the rule keys on **not `enforced`**
rather than on `experimental`.

`checkTransportWiredAdmission` in `authz-conformance.test.ts` now refuses a
`TRANSPORT-WIRED` key covered by any row that is not `enforced`, and
`checkLedger`'s existing enforced-has-site invariant supplies the other half —
the two compose into the promise the note makes, so flipping a row's state
without writing the site is refused as well. The rule lives beside the probe
table rather than in the shared ADR-0060 `checkLedger` helper on purpose:
`TRANSPORT-WIRED` is this ledger's own vocabulary, and five other conformance
ledgers share that helper without having transport tripwires. Tripwire keys are
now minted through one `tripwireKey()` helper so the marker cannot drift out of
the rule's sight (the keys themselves are byte-identical to before), and every
assertion in the file drives the composed gate instead of `checkLedger`.

The matrix note, the `covers` field TSDoc and both file headers were corrected
to describe the gate that actually ships — the declared-≠-enforced defect here
was in the *note*, so leaving it in place would only have moved the
discrepancy. Six cases pin the new rule, including both reverse-verification
legs and a positive control proving an `enforced` row naming its site still
admits the key; each refusal case also asserts that bare `checkLedger` accepts
the same ledger, so none can pass for an unrelated reason. Gate behaviour only
— no runtime, spec or product surface changes, and no matrix row changed state.
