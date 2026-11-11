---
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

fix(security): app-authored automation's system elevation does not change or delete the rows of an append-only object

Clause-②: no (narrowing: a system flow's, a system hook body's and an action body's update or delete of a managedBy 'append-only' object, and their delete of a record such a ledger row references, are refused at run time)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the run-time answer to an elevated automation's update or delete of an append-only object, and to its delete of a record such an object references. -->

**BREAKING** (a served-set narrowing) for app-authored automation that, while it runs as system, updates or deletes the rows of an object declared `managedBy: 'append-only'` — the audit log (`sys_audit_log`), the activity feed (`sys_activity`), the mail logs, the job-run log, the approval actions and the rest of that bucket — or deletes a record that one of those rows references. A census of the flows, hooks and action bodies in this repository and in HotCRM found none that does.

An append-only object is a ledger: its rows record what happened, and the platform service that owns the object writes them. A flow with `runAs: 'system'`, a sandboxed hook body that runs as system, and an action body — sandboxed, or through the action's engine facade — run elevated. Their elevation is the one the identity-assignment refusal already judges, and the same check now covers ledgers:

- An update, transfer, delete, purge or restore of an append-only object's rows from such a context answers `403 PERMISSION_DENIED`, and nothing is written. This check covers those five verbs; an insert is not judged by it. A flow's write node fails and the run hands the refusal to its caller; a hook's refusal aborts the triggering write under the default `onError: 'abort'`.
- A delete of a record that a ledger row references — a user that an audit row or an activity row names, for example — is refused the same way, whole: deleting the record would clear that reference on the ledger row, which is a change to an append-only object made under the automation's elevation. Nothing is deleted and the ledger row does not move. The message says so: deleting this record would change a record in an append-only ledger that references it.
- The message names the object, the source and the rule. The set is read from each object's `managedBy` on the live registry, so an append-only object a plugin registers is covered the day it registers.

Unchanged: reads of every append-only object from the same automation. Its writes to every other object — except a delete of a record a ledger row references, above — and the audit and activity rows the platform records for those writes. The platform's own writers — the retention sweeper, migrations and backfills, the audit seal, every service writing under a system context of its own — which carry neither a flow run nor the app-automation mark; a platform delete of a record a ledger row references still lands and clears the reference.

**What changes for you.** A flow, hook body or action body that rewrote or removed a ledger row while elevated now fails. Keep any value your automation must change on an object of your own app, and leave the ledger to the platform service that writes it; retention of ledger rows is the platform's lifecycle policy, declared on the object. An elevated automation that deleted a record a ledger row references — most often a user — now fails too: keep the record and retire it instead (for a user, deactivate it), or let the platform's own door delete it.

`@objectstack/spec`: the flow `runAs`, hook `runAs` and action `body` descriptions state the rule.
