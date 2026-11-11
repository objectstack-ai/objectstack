---
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

fix(security): app-authored automation's system elevation does not change or delete the rows of an append-only object

Clause-②: no (narrowing: a system flow's, a system hook's and an action body's update or delete of a managedBy 'append-only' object is refused at run time)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the run-time answer to an elevated automation's update or delete of an append-only object. -->

**BREAKING** (a served-set narrowing) for app-authored automation that updates or deletes the rows of an object declared `managedBy: 'append-only'` while it runs as system: the audit log (`sys_audit_log`), the activity feed (`sys_activity`), the mail logs, the job-run log, the approval actions and the rest of that bucket. A census of the flows, hooks and action bodies in this repository and in HotCRM found none that does.

An append-only object is a ledger: its rows record what happened, and the platform service that owns the object writes them. Three kinds of app-authored automation run elevated — a flow with `runAs: 'system'`, a hook with `runAs: 'system'` (or a system context it inherits, or its `ctx.api.sudo()`), and an action body, which always runs elevated. Their elevation is the one the identity-assignment refusal already judges, and the same check now covers ledgers:

- An update, delete, transfer, restore or purge of an append-only object's rows from such a context answers `403 PERMISSION_DENIED`, and nothing is written. A flow's write node fails and the run hands the refusal to its caller; a hook's refusal aborts the triggering write under the default `onError: 'abort'`.
- The message names the object, the source and the rule. The set is read from each object's `managedBy` on the live registry, so an append-only object a plugin registers is covered the day it registers.

Unchanged: reads of every append-only object from the same automation. Its writes to every other object, and the audit and activity rows the platform records for those writes. The platform's own writers — the retention sweeper, migrations and backfills, the audit seal, every service writing under a system context of its own — which carry neither a flow run nor the app-automation mark.

**What changes for you.** A flow, hook or action body that rewrote or removed a ledger row while elevated now fails. Keep any value your automation must change on an object of your own app, and leave the ledger to the platform service that writes it; retention of ledger rows is the platform's lifecycle policy, declared on the object.

`@objectstack/spec`: the flow `runAs` description states the rule.
