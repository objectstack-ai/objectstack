---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

the resume door's `repairable` is answered by the engine on the exits that stamp no status — `IAutomationService` declares the read-only `inspectConsumedSuspension` (#17541)

Clause-②: yes (widening)

The resume route's `400 FLOW_FAILED` details computed `repairable` as the single
expression `status === 'stranded'`. That word is stamped on exactly one exit —
the run that consumed its OWN pause and then threw downstream. The subflow
DELEGATION exit stamps nothing on purpose: a caller resumes the PARENT, the
signal is forwarded down, the child strands, and the parent frame answers
`{ success: false, error, durationMs }`, because nothing re-arms an ancestor by
resuming it and stamping `'stranded'` there would send an operator to retry a
recovery that cannot succeed.

Since the nested-chain restore landed, that parent's consumed pause IS
journalled and one `restoreConsumedSuspension(parentRunId)` re-arms the whole
chain leaf-first. So the wire answered `repairable: false` about a run the
operator verb WILL repair, and a client written exactly as the reference page
instructs closed it as terminal. Measured through the HTTP route, before and
after, on the same parked delegation:

```json
before  400 { "error": { "code": "FLOW_FAILED",
               "details": { "runId": "run_…", "repairable": false } } }
after   400 { "error": { "code": "FLOW_FAILED",
               "details": { "runId": "run_…", "repairable": true } } }
```

…while at that same instant the engine answered
`inspectConsumedSuspension(runId) → { repairable: true, witness: 'journal' }`
and `restoreConsumedSuspension(runId) → { restored: true, chain: [child, parent] }`.

**`@objectstack/spec` — additive, `minor`.** `IAutomationService` declares the
optional read-only member `inspectConsumedSuspension(runId)`, which
`AutomationEngine` already implements publicly: would the restore verb have a
consumed suspension to put back for this run? It re-arms nothing and reads the
same two witnesses that verb reads, so what it calls repairable IS what that
verb restores. The declared result is deliberately narrower than the
implementation's, the way `restoreConsumedSuspension`'s already is — `reason` is
typed as the string the implementation answers, not as an enumeration this
contract would have to keep in step, and the engine's wider type satisfies it
under `implements`. `ResumeFailureDetailsSchema.repairable`'s `.describe()` is
rewritten to the truth and the generated reference page regenerated with it. No
key is added, renamed or retired on any wire schema.

**`@objectstack/runtime` — the door.** On a `400 FLOW_FAILED` whose result
carries a `status`, that stamp still decides, and the engine is not consulted at
all. On a result that carries none, the door asks the declared member and relays
its `repairable`. Both ways of not getting an answer are FAIL-CLOSED: a service
that declares no inspection member answers `false` exactly as it did before, and
an inspection that REJECTS (a store it could not read) answers `false` and says
so once at `warn` — an unreadable store is UNKNOWN, not "nothing to restore",
and it is never allowed to replace the `400` the caller asked for with a `500`.

⛔ The fence is untouched: a cascade-failed ancestor is still never STAMPED
`'stranded'`. Its repairability is carried by the journal and REPORTED by the
inspection, which is exactly why the door asks instead of reading a word. ⛔ And
no new `AutomationResult.status` member is minted for this exit — there is
nothing new for a client to learn, and `details.repairable` is the member a
client was already told to branch on.
