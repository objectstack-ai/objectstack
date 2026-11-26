# ADR-0162: An object declares its closed states — in them the record and its master-detail lines are closed to change for every caller, a closed record is not deleted, and one lock read answers for pending approvals and for closed states

**Status**: Proposed — 2026-11-26, written for objectstack#36253 on the maintainer's ruling of 2026-11-22 (ruling record [`7073676422`](https://github.com/objectstack-ai/objectstack/issues/32004#issuecomment-7073676422), item ② = C). `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by an authorized approval or the maintainer's merge of the PR that carries it, and is in force from that merge. **This record declares; it implements nothing** — no schema key, no engine code, no route, no changeset; every mechanism below lands through a build card ([Execution](#execution-after-acceptance)). **Four points go past the ruling's words**; each is marked ▲ where it stands and all four are listed in [Points the ruling does not settle](#points-the-ruling-does-not-settle).

- **Date**: 2026-11-26
- **Card**: [#36253](https://github.com/objectstack-ai/objectstack/issues/36253) (p2, `area:data`). Its rule, as the card carries it:

  > An object declares the states in which it and its `master_detail` lines refuse add, edit, remove and move: for example approved, paid, closed. Approval, payment and closing only set the state. A record leaves the closed state only through a sanctioned action that moves it back. The runtime refuses changes to a closed record and its lines at every door, with one loud refusal.

  The card asks this record to settle four things: the key's shape on the object; the unit; the exemptions and whether a closed document may be deleted; one lock read for both producers. [D1](#d1--the-key-closedstates) to [D10](#d10--where-it-is-enforced-and-how-it-sits-beside-the-mechanisms-that-exist) answer them.
- **Decided by**: the maintainer, 2026-11-22, in one batch, verbatim and untranslated: 「① A ② C ③ C ④ A ⑤ A」. The ruling record states item ② as a rule:

  > **A decided document:** the object declares the states in which it and its lines are closed to change. Approval, payment and closing only set the state. A Feature and ADR card carries this.

  This record is that card's ADR. It executes item ② and re-opens none of the other four.
- **Rulings that stand beside it** (⛔ none is re-opened here): item ① of the same batch and the 2026-11-19 「一起锁」 ruling (a record held by a pending approval locks its lines with it, with no switch); item ③ (a field lock that reads its own field holds if its condition is true before or after the write); item ④ (entering a state machine from an empty state is an entry, into an initial state); item ⑤ (an elevated server context never crosses the organization wall).
- **Builds on**: [ADR-0019-approval-as-flow-node](./0019-approval-as-flow-node.md) (the pending-approval record lock, whose unit and whose refusal this record shares), [ADR-0020](./0020-state-machine-converge-and-enforce.md) (the state field and its legal moves), [ADR-0034](./0034-transactional-writes-and-ambient-transaction.md) (the unit of work a write runs in), [ADR-0035](./0035-config-driven-master-detail.md) and [ADR-0055](./0055-master-detail-controlled-by-parent.md) (a `master_detail` line belongs to its master), [ADR-0049](./0049-no-unenforced-security-properties.md), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) and [ADR-0078](./0078-no-silently-inert-metadata.md) (a declared key is enforced and proven to run, or it is not declared), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (coded refusals and their emitters), [ADR-0124](./0124-server-enforces-client-is-courtesy.md) (the server enforces; the client's gating is a courtesy), [ADR-0148](./0148-recycle-bin-separate-store-restore-under-original-ids-retention-in-days.md) (delete, the recycle bin and restore).
- **Leaves unchanged**: the pending-approval lock's write side, as it stands on `main` (the record lock, the line lock, the delete that lands and cancels the request); `readonlyWhen`, in every respect; the `state_machine` validation rule; the `userActions` display predicates; every permission grant. Nothing in this record changes what an object that does not declare the new key does.
- **Inputs**: every code and docs text cited below was read on `objectstack-ai/objectstack` `main` at `6c290d3af7`, the commit this record's branch starts from. Positions are in [Readings](#readings-taken-at-6c290d3af7).

---

## Provenance

Three kinds of statement appear below, and they are kept apart.

- **Ruled.** The quoted rule of item ② and the four rulings that stand beside it. This record adds nothing to them and takes nothing away.
- **This record's decisions.** D1 to D10. Where a decision only spells out what the ruling's words already require, it carries no mark. Where it chooses among readings the ruling leaves open, it is marked ▲ and the alternative is recorded in [Alternatives considered](#alternatives-considered). The maintainer's merge adopts the marked points with the rest; until then they are proposals.
- **Readings.** What the code and docs do today, each with the place it was read at the commit above. A reading is a dated fact, not a decision.

One premise of the card was not checked: the card names "a hosted app's edit guards" as a producer beside approvals. That app's code is outside this repository and was not read. This record relies on it only as the card states it.

## TL;DR

- An object may declare **`closedStates`**: for one or more of its state fields, the values in which a record of that object is closed. Nothing is stored for it; a record is closed when its stored state says so.
- A closed record **and its direct `master_detail` lines** are closed to change. This is the same unit the pending-approval lock holds.
- **Every caller is bound**, at every door, whatever grants it holds. The state field itself is frozen with the rest. ▲ **A system context is not bound**: the platform's own services, and the app's own elevated automation (an action body, a flow or hook that runs as system). That automation is how a closed document is reopened or moved on.
- ▲ **A closed record is not deleted by a caller**, and a delete whose cascade would reach a closed record or a line of one is refused whole.
- ▲ The lock is judged on **the row as stored when the write reaches it**. The write that closes a record lands whole; the next one is refused.
- The refusal is the one clients already handle, **`409 RECORD_LOCKED`**, with its own sentence.
- ▲ **One lock read**, owned by the data layer, answers for both producers and says which one holds. The approvals-family routes stay and are served from it.
- The showcase's three paid-invoice hooks become one declaration. That conversion is the proof.

## Context

### What a document's life looks like, and where the platform stops today

A business document is drafted, submitted, decided, and then it is finished: an approved purchase order, a paid invoice, a posted journal, a closed period's timesheet. After that point the document is evidence. People still read it, and automation may still move it on (a paid invoice is refunded; an approved order is cancelled by a controller), but nobody edits its amounts or swaps its lines by hand.

The platform holds a document through the first half of that life and lets go at the decision.

- **While an approval is pending**, the record is locked: an update is refused `409 RECORD_LOCKED` (`packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindApprovalLockHook`), and so is adding, editing, removing or moving one of its `master_detail` lines (`#bindDetailRowLockHook`). That is ADR-0019-approval-as-flow-node's lock, extended to the lines by the 「一起锁」 ruling.
- **When the approval is decided**, the request is finalised and the lock is gone. The approvals guide says so twice in as many sections: "the record unlocks" (`content/docs/automation/approvals.mdx`). PR [#36135](https://github.com/objectstack-ai/objectstack/pull/36135), which taught the lock read to answer for lines, says it in its own body: "Decided documents are not locked; edits after the decision are not in this PR."

What happens after the decision is the app author's job today, and the author has three tools, none of which says "this document is closed":

1. **`readonlyWhen` on each field.** A field whose predicate is true is stripped from a caller's update (`packages/objectql/src/validation/rule-validator.ts#stripReadonlyWhenFields`). It is a field lock: the author names every field one by one, a new field is unlocked until someone remembers it, and it cannot refuse a new line, a removed line or a delete.
2. **Display predicates on the built-in buttons.** `userActions.edit.disabledWhen` and `userActions.delete.visibleWhen` grey or hide a button. The spec says what they are: "advisory UI gating only" (`packages/spec/src/data/object.zod.ts`). The write itself is not judged.
3. **Hand-written hooks.** The showcase's invoice is the worked example. Its line object locks line fields with `readonlyWhen` predicates that read the header's status, and three hooks refuse adding, moving and removing a line under a paid invoice (`examples/app-showcase/src/data/hooks/index.ts#GuardPaidInvoiceLineAddHook`, `#GuardPaidInvoiceLineMoveHook`, `#GuardPaidInvoiceLineRemoveHook`). The header itself is covered by one `readonlyWhen` field and the two display predicates (`examples/app-showcase/src/data/objects/invoice.object.ts`).

Those hooks exist because of an earlier ruling. On [#24684](https://github.com/objectstack-ai/objectstack/issues/24684) the seat ruled "C, so B now" (record [`6281609466`](https://github.com/objectstack-ai/objectstack/issues/24684#issuecomment-6281609466)): the showcase writes its own hooks now, and a declarative lock "returns only with a named producer beyond this showcase". Item ② of the 2026-11-22 batch is that return. It names the producers — approval, payment, closing — and says what they have in common: each only sets a state. The lock belongs to the state, declared once on the object, and not to whichever producer set it.

### The two locks that exist, and why neither is this one

| | Pending-approval lock | `readonlyWhen` |
|---|---|---|
| Holds | a record while a request on it is pending, and its lines | one field while its predicate is true |
| On a caller's write | refuses the write, `RECORD_LOCKED` | strips the field and lets the rest land |
| A system context | passes (`session.isSystem`) | does **not** pass; only a value a hook derived inside the same write survives |
| Delete | the record's delete lands and cancels the request; a line's delete is refused | not judged |
| Readable by a client | yes: `getRecordLock` / `getRecordLocks` | through the field's own metadata |
| Ends | when the request is decided, recalled or cancelled | when the predicate turns false |

The pending lock has the right unit and the right refusal, but its producer is a request row that ends at the decision. `readonlyWhen` reads the right fact, the record's own state, but it is a field rule. The closed-state lock takes the unit and the refusal from the first and the fact from the second.

### The lock read that exists

A client can ask whether a record is locked before it offers an edit. The contract is `IApprovalService.getRecordLock` and its page form (`packages/spec/src/contracts/approval-service.ts#getRecordLock`, `#getRecordLocks`), answering `{ locked, lockSource?: 'record' | 'master' }`, or `null` when the caller cannot read the record. It is served by two approvals-family routes, composed into the record page's approvals part (`packages/rest/src/record-page-routes.ts#answerApprovals`), and read by the console's record page and grid (`ui/packages/app-shell/src/hooks/useRecordApprovals.ts`, `ui/packages/plugin-grid/src/hooks/useRowApprovalLocks.ts`). It lives in the approvals plugin because approvals was the only producer. With a second producer that the data layer itself enforces, a read that exists only when the approvals plugin is installed can no longer be the one read.

## Decision

### D1 — The key: `closedStates`

An object may declare, at object level, the states in which its records are closed:

```ts
// An invoice that is closed once paid or voided, or once its approval is decided.
closedStates: {
  status: ['paid', 'void'],
  approval_status: ['approved'],
}
```

- **Shape.** A map from a field of this object to the list of that field's values that close the record. A record is closed when **any** listed field holds one of its listed values ([D2](#d2--closed-is-read-off-the-stored-row-nothing-is-stored-for-it)). Two fields are the ordinary case, not an edge: an approval mirrors its outcome into one field and the business status lives in another, and the ruling's sentence "approval, payment and closing only set the state" is about exactly those producers.
- **What a field must be.** A stored, single-value `select` field of the object. Each listed value is one of that field's declared option values. A list is not empty and repeats nothing.
- **Refused where the object is authored.** A declaration that breaks one of those rules is a named refusal at parse and publish, the way `deleteBehavior: 'set_null'` on a `master_detail` is (`packages/spec/src/data/field.zod.ts`). So is removing or retyping a field, or removing an option, that a declaration still names. A closed-state declaration that cannot be evaluated never reaches a running app.
- **Optional, and absent means nothing.** An object without the key behaves exactly as it does today.
- **The line object declares nothing.** Being a `master_detail` line of a declaring object is what closes a line ([D3](#d3--the-unit-the-record-and-its-direct-master_detail-lines)). A line object may also declare its own `closedStates`, for a line that closes on its own.
- **No tie to a state machine.** The key does not require a `state_machine` rule on the field, and a `state_machine` rule does not imply the key. The rule says which moves are legal; the key says when the record stops accepting a caller's writes.
- **The name.** `closedStates`, not `lockedStates`: "locked" is the word the product already uses for a pending approval, where the lock releases by itself when the approval ends. A closed state does not end by itself.

For a metadata author this is a new key: the spec build card declares `Metadata-protocol: added`.

### D2 — Closed is read off the stored row; nothing is stored for it

A record is **closed** when, for at least one field its object's `closedStates` names, the stored value is one of the listed values. An empty state value closes nothing.

There is no closed flag, no lock row and no backfill. Two consequences follow, and both are intended:

- Whatever sets the state closes the record: an approval's status mirror, a payment service, an action, a caller's own edit of the state field where the app leaves that field writable. The producers "only set the state".
- Publishing a declaration closes every stored record already in a listed state, from that publish. Removing a value opens them again. Changing the declaration is an ordinary metadata change by whoever may author the object.

### D3 — The unit: the record and its direct `master_detail` lines

The unit a closed record holds is the record itself and every row, of any object, that points at it through a `master_detail` field. This is the unit of the pending-approval line lock (`packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindDetailRowLockHook`), by the card's own words.

- **Every `master_detail` edge counts.** A junction row under two masters is a line of both; it is closed when either master is.
- **One level.** A line's own lines are not in the unit. If deeper levels are ever wanted, that is decided for both producers at once, so the unit stays one.
- **Not in the unit:** rows that reference the record through a `lookup`, and the record's satellites that live in their own objects (comments, attachments, shares, history). They keep their own rules. A file field **on** the record is a field of the record and is closed with it.

### D4 — What a closed unit refuses, and when it is judged

For a writer that [D5](#d5--who-is-bound-every-caller-a-system-context-is-not) binds:

| Write | On a closed record | On a line of a closed record |
|---|---|---|
| Create | not judged: there is no stored state yet | refused |
| Update | refused, whichever fields it carries, the state fields included | refused |
| Delete | refused ([D6](#d6--a-closed-record-is-not-deleted-by-a-caller)) | refused |
| Move a line to another master | — | refused when either end is closed: out of a closed master, or into one |

- **An update is judged by the keys it carries.** One that carries no field writes nothing and is not refused; any other is a change, whether or not its values differ from the stored ones. This is the pending lock's own rule.
- **Whole or nothing.** A write that names many rows — a predicate update or delete, a many-row create of lines — is refused whole when one row it reaches is closed or is a line of a closed record, before any row is written.
- **Unresolved is refused.** A line whose master cannot be resolved, or a predicate write whose rows cannot be listed within the engine's bounds, is refused. The lock fails closed, as the pending lock does.
- **Creating a record in a closed state is not this lock's question.** Whether a record may be born `paid` is the state field's own rule: `initialStates` on its `state_machine`, and item ④ of the batch.

▲ **The lock is judged on the row as stored when the write reaches it**, inside the unit of work the write runs in ([ADR-0034](./0034-transactional-writes-and-ambient-transaction.md)).

- The write that takes an open record into a closed state **lands whole**, with whatever other fields it carries. The record was open when the write began, and the same caller could have made the same edits one write earlier.
- The road **into** a closed state is not guarded here. Who may set `status` to `paid`, and from where, stays with the field's permissions, the `state_machine` rule and the app's own actions.
- Inside one unit of work, order matters: once the closing write has landed, a later write in the same unit meets a closed record. A save that edits lines and closes the document writes the lines first. The console's master-detail save puts the header first today (`ui/packages/plugin-form/src/masterDetailTx.ts`); its build card orders a closing header write last.

Item ③ of the batch is about a different lock and is not restated here: a `readonlyWhen` field lock that reads its own field keeps the before-or-after rule that item gives it. An object that carries both gets both.

### D5 — Who is bound: every caller; a system context is not

**Bound: every write made in a caller's context, at every door.** The data API and its batch forms, a page or grid in the console, an API key, an AI agent acting for a principal, and automation that acts as the caller: a flow that runs as the user, which is a flow's default, and a hook that runs as the user or inherits the context of the caller's write, which is a hook's default.

- **No grant opens a closed record.** No permission set, no `modifyAllRecords`, no administrator role. The pending lock has no such exemption either; an administrator who must change a closed document uses the app's own action for it, as below.
- **The state field is frozen with the rest.** A caller cannot reopen a closed record by editing its state. If it could, the lock would be one edit deep.

▲ **Not bound: a write made in a system context**, the context no client can assert for itself.

- **The platform's own services**: the approval status mirror (`packages/plugins/plugin-approvals/src/approval-service.ts#mirrorStatusField`), summary recompute (`packages/objectql/src/engine-summaries-and-expansion.ts#recomputeSummaries`), retention, an import or seed that runs as system.
- **The app's own elevated automation**: an action body (`packages/runtime/src/action-execution.ts#buildActionExecutionContext`), and a flow or hook declared `runAs: 'system'` (`packages/spec/src/automation/flow.zod.ts#runAs`).

This is how the card's sentence is met: "a record leaves the closed state only through a sanctioned action that moves it back". "Refund", "Void", "Reopen for correction" are actions the app ships, each with its own gate on who may run it; the action's body sets the state, and an open record is an ordinary record again. An app that ships no such action has no way for a user to reopen, and that is a legitimate product: closed is closed.

The mark is on the breadth of the exemption. The card leaves "system writes" to this record, and this record does not limit a system context to moving the state: it is not bound at all, as it is not bound by the pending lock. The narrower reading is in [Alternatives considered](#alternatives-considered).

Three reasons the system context passes here although `readonlyWhen` deliberately does not exempt it:

1. **There has to be a way out.** `readonlyWhen` can refuse system contexts because a hook-derived value inside the same write still lands, so the field keeps a server-side write path. A record-level lock with no exemption would have none: a paid invoice could never be refunded and an approval mirror could never move a decided document.
2. **One read cannot mean two things.** The pending lock passes a system context. The lock read of [D9](#d9--one-lock-read-owned-by-the-data-layer) answers for both producers with one word, `locked`, and a client must be able to read it without asking which rulebook applies.
3. **It is what the proof already does.** The showcase's hooks, written under the earlier ruling, pass a system session. Converting them to the declaration changes no line-level outcome for a system write.

What elevation does not reach today — identity assignment, append-only ledgers, the organization wall (item ⑤) — is unchanged and is not extended here. `readonlyWhen` remains the tool for a field that must hold even against system writes.

### D6 — A closed record is not deleted by a caller

▲ A bound writer's delete of a closed record is refused `RECORD_LOCKED`.

This differs from the pending lock, where the record's delete lands and cancels the request. The difference is deliberate. A pending approval is a window with something to cancel, and the ruling behind it vetoed forbidding the delete. A closed state is where the document ends up; there is nothing to cancel, and deleting it is the largest change that can be made to it. Apps already hide the delete button on closed documents (the showcase does); under ADR-0124 the server enforces what that button promises.

- **Cascades.** A delete whose cascade would remove a closed record, or a line of a closed record, is refused whole. The engine already collects the full set a delete will remove before it writes anything (`packages/objectql/src/engine-cascade-planning.ts#cascadeDeleteRelations`); the closed-state judgement is made on that set, at the point the engine's own in-cascade `restrict` refusals are made. No row is removed by a delete this rule refuses.
- **A system context deletes** ([D5](#d5--who-is-bound-every-caller-a-system-context-is-not)): retention, the removal of an organization, an app's own action.
- **"The record's own delete" as an exemption**, which the card asks about, therefore exists only where the delete itself is allowed: when a system context deletes a closed record, its lines go with it through the cascade and no leg is refused.

### D7 — Writes that are not a caller's change

Some writes reach a closed record or its lines without being anyone's edit. Each is named here so the build does not have to guess.

- **Referential clears land.** When a record is deleted, the engine clears optional lookups that pointed at it, in the caller's context. On a closed record, or a line of one, that clear lands: exactly the cleared field, at exactly the value the engine wrote, and nothing else in the same payload. This is the exemption `readonlyWhen` already gives the same write (`packages/objectql/src/validation/rule-validator.ts#ReferentialClearExemption`), including the recycle-bin restore's re-link of that reference.
- **Engine-derived writes that run as system pass by D5.** The build card for the engine lists each one it meets and pins it with a test; a derived write that turns out to run in the caller's context is reported back, not exempted on the spot.
- **Restore.** A recycle-bin entry comes back as it stood, closed or not: restore writes rows back, it does not edit them (ADR-0148 D2). One case is refused before anything is written: an entry that would put a row back under a **live, closed** master that is not itself part of the entry. That is adding a line to a closed document through another door, and it answers `RECORD_LOCKED`. A restore run in a system context passes.

### D8 — The refusal

- **One code: `409 RECORD_LOCKED`.** It is the code clients already handle for the pending lock, and its meaning to a client is the same: this record is locked, and the write did not land. The engine package becomes an emitter of the code in the ADR-0112 ledger (`packages/spec/src/api/error-code-ledger.zod.ts`), beside the approvals plugin and the upload-link door.
- **Its own sentence.** The pending lock's end-user sentence tells the reader to wait until the approval completes (`packages/spec/src/system/operation-message.ts#record_locked`). That is false for a closed document, so the closed-state refusal has its own sentence family in the Operation Message Catalog, in every locale the catalog carries, with the same four forms (with object label and title, without a title, without a label, naming nothing).
- **What the sentence may name.** The closed document, by its object's label and its title. For a line write it names the master, and it does not read the master's row on the deny path, so it takes the label-only form, as the pending line lock does. It never carries a record id, an API name, or the state's value: a reader who may see the state reads it off the record.
- **When both locks hold**, either refusal is correct and both carry the same code. The closed-state judgement runs before the before-phase hooks ([D10](#d10--where-it-is-enforced-and-how-it-sits-beside-the-mechanisms-that-exist)), so the closed sentence is the one the writer sees.

### D9 — One lock read, owned by the data layer

▲ There is one answer to "is this record locked", it is owned by the data layer, and every door that asks reads it.

```ts
// For one record, as the caller. `null`: the caller cannot read the record, or it does not exist.
{ locked: boolean; lockSource?: 'record' | 'master'; lockReason?: 'closed_state' | 'approval' } | null
```

- **Two producers, both named here.** The engine's own closed-state judgement, and the approvals plugin's pending-request judgement (the one behind today's `getRecordLock`). The read composes them. A third producer is a new decision, not a registration: the seam between the engine and the approvals plugin is internal.
- **It exists without the approvals plugin.** An app that installs no approvals still declares closed states and still has a lock read.
- **`locked` means locked for a caller** ([D5](#d5--who-is-bound-every-caller-a-system-context-is-not)). The read does not answer for system contexts.
- **`lockReason` says which producer holds.** A client words its banner from it: "in approval" and "closed" are different things to tell a user. It is the only new member.
- **One answer when several hold.** The reason is chosen first, `closed_state` before `approval`; within a reason, `master` before `record`, which is today's rule. A closed document with a stale pending request reads as closed.
- **What it never carries.** Which field or value closed the record, a request id, or participants. The same disclosure line the read has today.
- **Same anchor, same page bound.** The read is made as the caller; a record the caller cannot read answers `null`, the same as a missing one. The page form keeps today's bound of 200 ids (`packages/spec/src/contracts/approval-service.ts#APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS`).
- **Doors.** The data family gains the read for one record and for a page of records, with SDK methods beside the other data reads. The exact path spelling is the build card's. The two approvals-family routes and their SDK methods **stay** and are served from the same read, so there is never a second answer; retiring them is not decided here.
- **Every in-process asker moves to it.** The record page's approvals part, the upload-link door that asks before it issues a link, and the console's record and grid hooks ask the one read. `IApprovalService.getRecordLock` and `getRecordLocks` remain as the approvals producer's own answer; no door reads them directly any more.

The pending lock's write side is untouched. One read, two enforcers: the engine for closed states, the approvals plugin's hooks for pending requests.

### D10 — Where it is enforced, and how it sits beside the mechanisms that exist

- **In the engine's write path.** Not in an optional plugin and not in a hook an app could forget: a declared `closedStates` is enforced wherever a record of the object can be written (ADR-0049, ADR-0078). The key and its enforcement ship in the same release, and the showcase conversion is the runtime proof ADR-0054 asks for.
- **Before the before-phase hooks.** A write refused for its own record, or for its own master, runs no app hook. A delete refused for what its cascade would reach is refused where the cascade is planned, before any row is removed ([D6](#d6--a-closed-record-is-not-deleted-by-a-caller)).
- **Free when not declared.** Whether an object declares the key, or is a line of one that does, is read from the registry. An object that is neither pays nothing.

| Mechanism | After this record |
|---|---|
| Pending-approval lock | Unchanged. Both locks may hold the same record; either refuses. |
| `readonlyWhen` | Unchanged, with its own rules (item ③). Still the tool for "these fields freeze in these states", and for a field that must hold against system writes. On a caller's write to a closed record the closed-state refusal answers first, so nothing is stripped. |
| `state_machine` | Unchanged. It says which moves are legal for whoever may make them. `closedStates` says when a caller may write at all. |
| `userActions` predicates | Unchanged, and still display only. The console reads the lock read to grey edit and hide delete on a closed record, so an author no longer has to spell that out per object. |
| Permissions | Unchanged. A closed state grants nothing and no grant lifts it. |

## Execution (after acceptance)

Nothing below starts before this record is Accepted. The seat files the cards; this list is their scope, not their text. Each is a child of #36253.

1. **The key and its enforcement, released together.** The spec key with its authoring refusals, form row, reference docs and liveness proof ([D1](#d1--the-key-closedstates)); the engine's judgement on update, delete, line writes, many-row writes, the cascade set and restore ([D2](#d2--closed-is-read-off-the-stored-row-nothing-is-stored-for-it) to [D7](#d7--writes-that-are-not-a-callers-change)); the ledger row and the sentence family in every locale ([D8](#d8--the-refusal)). One PR or a stacked pair, but the key is never published without its enforcement (ADR-0078). `Metadata-protocol: added`.
2. **The one read.** The engine's read, the internal seam the approvals producer answers through, the data-family routes and SDK methods, the approvals-family routes re-served from it, and the in-process askers moved ([D9](#d9--one-lock-read-owned-by-the-data-layer)).
3. **The showcase conversion — the proof.** The three paid-invoice line hooks are deleted and the invoice declares `closedStates`. The card records, as a dogfood run against the running app, each refusal the hooks gave before and the declaration gives after, and the two outcomes that change by design: a caller's edit of a paid invoice's header fields, and a caller's delete of a paid invoice, are now refused.
4. **The console.** The record page, the grid and the line grid read the one read and word the reason; edit is greyed and delete hidden on a closed record without per-object predicates; the master-detail save writes a closing header last ([D4](#d4--what-a-closed-unit-refuses-and-when-it-is-judged)).
5. **Docs.** The approvals guide's "the record unlocks" passages gain a pointer to closed states; the data-modelling guide documents the key, with the authoring notes of [Consequences](#consequences).

Three things the build verifies and pins, because this record read them but did not run them:

- The approval status mirror is written after the request is finalised, and a failure of that write is logged and swallowed (`packages/plugins/plugin-approvals/src/approval-service.ts#mirrorStatusField`). Where the mirrored value is a declared closed state, the document is open between the two writes, and stays open if the mirror fails. The engine card measures whether both writes share one unit of work and reports what it finds; changing the approvals plugin's behaviour is a card of its own.
- Which engine-derived writes reach a closed record, and in which context each runs ([D7](#d7--writes-that-are-not-a-callers-change)).
- Whether a customization overlay may add `closedStates` to an installed package's object, and that it may not shorten a package's own list, under the overlay rules in force when the spec card is built. If the answer changes what a subscriber can do to a packaged document, it comes back as a decision card.

## Points the ruling does not settle

The ruling says the object declares the states and that the record and its lines are closed to change. Four decisions above choose among readings it leaves open. The maintainer's merge adopts them; each can be struck without touching the rest.

| ▲ | Decision | What it means for a user | The other reading |
|---|---|---|---|
| 1 | [D5](#d5--who-is-bound-every-caller-a-system-context-is-not): a system context is not bound at all, where the card's words require only a sanctioned action that moves the state | A user, an administrator included, cannot edit or reopen a closed document by hand. The app's own actions and system automation can, and they can also change a closed document without reopening it. | Elevated automation may move only the state, and must reopen a document before changing it. |
| 2 | [D6](#d6--a-closed-record-is-not-deleted-by-a-caller): a caller cannot delete a closed record | Delete is refused on a closed document, where a pending one can still be deleted. | Delete lands with its lines, as under the pending lock. |
| 3 | [D4](#d4--what-a-closed-unit-refuses-and-when-it-is-judged): judged on the stored row | "Edit and mark paid" in one save works; an edit after that does not. Inside one save, the closing write goes last. | Judge the result as well, so a write that closes may carry only the state. |
| 4 | [D9](#d9--one-lock-read-owned-by-the-data-layer): the read moves to the data layer, gains `lockReason`, and the approvals routes are served from it | The console can tell "in approval" from "closed", with or without the approvals plugin. | Keep the read in the approvals plugin and add a second read for closed states. |

Left open on purpose, each a later decision if it is ever wanted:

- **Ownership transfer of a closed document.** It is an update of the record, so a caller's transfer is refused; a system context transfers. If day-to-day reassignment of closed documents proves necessary, exempting the ownership field is an amendment to D5.
- **Fields that stay editable on a closed record** (a note, a tag). Not offered. An app that needs it keeps the field on a satellite object.
- **Deeper levels of lines.** One level, as the pending lock ([D3](#d3--the-unit-the-record-and-its-direct-master_detail-lines)).
- **State fields that are not a `select`** (a boolean "posted"). Not admitted by [D1](#d1--the-key-closedstates).
- **Retiring the approvals-family lock routes.**

## Consequences

**What gets better**

- "This document is closed" is one line on the object. New fields and new line objects are covered without anyone remembering them.
- The server enforces it at every door. A hidden button and a refused write now say the same thing.
- A client asks one question, gets one answer, and can word it.
- The showcase loses three hooks and gains a declaration that any app can copy.

**What an author has to know**

- **Publishing a declaration closes existing records at once** ([D2](#d2--closed-is-read-off-the-stored-row-nothing-is-stored-for-it)). There is no grace period and no backfill to wait for.
- **Automation that acts as the caller is refused on a closed record.** A flow that runs as the user and stamps a field after the document closes fails with `RECORD_LOCKED`. Either the stamp belongs in the write that closes the document, where a before-phase hook can derive it, or the flow is declared to run as system. The same holds for a hook that writes back to the record after it closed.
- **Elevated automation is not bound.** An action body that updates a field does so on a closed record too. An author who wants an action to respect the closed state gates the action on the state.
- **The way out is an action.** An app that wants users to reopen, void or refund ships the action and decides who may run it.
- **Line edits go before the closing write** when both travel in one save.

**What it costs**

- A write to a line reads its master's state fields. A write to an object that neither declares the key nor is a line of one reads nothing extra.
- The read grows a second producer and a seam between two packages. The approvals contract keeps two members that no door reads directly any more.
- Two outcomes change in the showcase when it converts: a caller can no longer edit a paid invoice's header or delete a paid invoice. No platform default changes; an app is affected only when it declares the key.

## Alternatives considered

**The key**

- **A predicate (`closedWhen`, a CEL expression).** More expressive, but "closed" would then fault, depend on related rows and need ADR-0137's fault semantics on every write and every read of the lock. The ruling says states; a list of states cannot fault and can be checked at publish.
- **A flag on each option of the state field.** Puts the lock in the field's option list, where a reader of the object does not look for it, and makes two-field declarations two separate edits.
- **A key on the `state_machine` rule, beside `initialStates`.** A validation rule has `events`, `severity` and `active`, and seeds skip it. A lock that can be switched off by deactivating a rule, or that a seed bypasses by construction, is not the declaration the ruling asks for.
- **`lockedStates`.** See [D1](#d1--the-key-closedstates).

**Who is bound** (▲ 1)

- **Elevated app automation may change only the state fields of a closed record.** Stronger: an action could not edit a closed document without reopening it first. It was not chosen because it splits "system" into two classes on this one path, turns "refund and stamp the refund" into three writes, and makes the showcase conversion change outcomes for system writes that the earlier ruling settled.
- **A caller may move the state along a declared `state_machine` transition.** Declarative, with no action to write. Not chosen because a transition says which moves are legal, not who may make them; every editor could reopen wherever a transition out of a closed state exists, including the ones declared for automation. It is also not the card's rule, which names a sanctioned action.
- **An administrator grant that lifts the lock.** The pending lock refused this, and for the same reason: an override belongs in an audited action, not in an edit.
- **Bind system contexts too, as `readonlyWhen` does.** Leaves no way to move a closed document at all.

**Delete** (▲ 2)

- **Let the delete land, with its lines, as the pending lock does.** Consistent between the two locks, and the recycle bin makes it recoverable. Not chosen because the pending lock's rule exists to cancel a request, and because a document that can be deleted by anyone who may delete its object is not closed.
- **A per-object switch.** Item ① of the batch chose "no switch" for the lines; a switch here would be the first.

**When it is judged** (▲ 3)

- **Judge the result as well as the stored row**, as item ③ rules for a `readonlyWhen` lock that reads its own field. Then a caller's write that closes a record could carry nothing but the state. That refuses "record the payment and mark paid" in one write and buys no integrity: the same caller may make the same edits one write earlier.
- **Judge against the state at the start of the unit of work**, so that one save may close the header first and write its lines after. Friendlier to a client that orders its writes header-first, but it needs per-unit memory in the engine and behaves differently on a store with no transactions. Ordering the closing write last gives the same result with no new mechanism.

**The read** (▲ 4)

- **Keep the read in the approvals plugin and have it ask the engine.** An app without approvals would then have closed states and no way to read them.
- **Two reads, one per producer.** Every client would have to call both and combine them, and each new door would have to remember the second.

**The status quo — each app writes its hooks.** That is the "B" of the earlier ruling, taken until a producer beyond the showcase was named. The 2026-11-22 ruling names them.

## Readings, taken at `6c290d3af7`

| What was read | Where |
|---|---|
| The pending record lock: a global before-update hook; passes a system session, the run that opened the request, and a write that carries only the status mirror field; no administrator exemption; refuses `RECORD_LOCKED`, 409 | `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindApprovalLockHook`, `#lockedError` |
| The pending line lock: insert, update, delete and move under a held master are refused; the cascade leg of the held master's own delete yields; an unresolved master is refused | `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindDetailRowLockHook`, `#soleCascadeEdgeOf`, `#inOpenUnit` |
| Deleting a record with a pending request lands and cancels the request | `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindRecordDeleteCancelHook` |
| The lock read's contract, its answer, its `null`, its page bound | `packages/spec/src/contracts/approval-service.ts#getRecordLock`, `#getRecordLocks`, `#APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS` |
| The two approvals-family lock routes | `packages/rest/src/rest-route-ledger.ts` |
| The record page composes the lock into its approvals part | `packages/rest/src/record-page-routes.ts#answerApprovals` |
| The console's two readers of the lock | `ui/packages/app-shell/src/hooks/useRecordApprovals.ts`, `ui/packages/plugin-grid/src/hooks/useRowApprovalLocks.ts` |
| "The record unlocks" on a decision | `content/docs/automation/approvals.mdx` |
| The status mirror: written after the request is finalised, in a system context; a failure is logged and swallowed | `packages/plugins/plugin-approvals/src/approval-service.ts#mirrorStatusField` |
| `readonlyWhen`: strips a caller-supplied value; a system context is deliberately not exempt; a hook-derived value survives | `packages/objectql/src/validation/rule-validator.ts#stripReadonlyWhenFields`, `#isCallerSuppliedValue` |
| The referential clear and the restore re-link are exempt from the read-only strips | `packages/objectql/src/validation/rule-validator.ts#ReferentialClearExemption` |
| The `state_machine` rule: `field`, `transitions`, `initialStates` | `packages/spec/src/data/validation.zod.ts#StateMachineValidationSchema` |
| `userActions` predicates are "advisory UI gating only" | `packages/spec/src/data/object.zod.ts` |
| No `closedStates` key, or any key of that meaning, exists on the object schema | `packages/spec/src/data/object.zod.ts` |
| A delete collects its whole cascade set, then judges in-cascade `restrict`, then writes | `packages/objectql/src/engine-cascade-planning.ts#cascadeDeleteRelations` |
| Summary recompute writes the master in a system context | `packages/objectql/src/engine-summaries-and-expansion.ts#recomputeSummaries` |
| Restore writes rows back through the driver, with no insert hook | `packages/objectql/src/recycle-bin/restore.ts` |
| An action body runs elevated | `packages/runtime/src/action-execution.ts#buildActionExecutionContext` |
| A flow's `runAs` defaults to the user | `packages/spec/src/automation/flow.zod.ts#runAs` |
| `RECORD_LOCKED` is registered for the approvals plugin and for the upload-link door | `packages/spec/src/api/error-code-ledger.zod.ts` |
| The pending lock's end-user sentence and its four forms | `packages/spec/src/system/operation-message.ts#record_locked` |
| The showcase: three paid-invoice line hooks, each passing a system session; `readonlyWhen` on line fields; display predicates on the header | `examples/app-showcase/src/data/hooks/index.ts#GuardPaidInvoiceLineAddHook`, `#GuardPaidInvoiceLineMoveHook`, `#GuardPaidInvoiceLineRemoveHook`; `examples/app-showcase/src/data/objects/invoice.object.ts` |
| The console's master-detail save writes the header as its first operation | `ui/packages/plugin-form/src/masterDetailTx.ts`, `ui/packages/plugin-form/src/MasterDetailForm.tsx` |

Not read: the hosted app the card names as a producer ([Provenance](#provenance)).

## Refs

- Card [#36253](https://github.com/objectstack-ai/objectstack/issues/36253); ruling record [`7073676422`](https://github.com/objectstack-ai/objectstack/issues/32004#issuecomment-7073676422) on #32004.
- The earlier ruling "C, so B now": record [`6281609466`](https://github.com/objectstack-ai/objectstack/issues/24684#issuecomment-6281609466) on #24684; the showcase hooks landed in PR [#24731](https://github.com/objectstack-ai/objectstack/pull/24731).
- The lock read for lines: PR [#36135](https://github.com/objectstack-ai/objectstack/pull/36135).
