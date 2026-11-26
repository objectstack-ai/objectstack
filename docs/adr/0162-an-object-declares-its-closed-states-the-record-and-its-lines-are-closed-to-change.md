# ADR-0162: An object declares its closed states — in them the record and its master-detail lines are closed to change for every caller, a closed record is not deleted, and one lock read answers for pending approvals and for closed states

**Status**: Proposed — 2026-11-26, written for objectstack#36253 on the maintainer's ruling of 2026-11-22 (ruling record [`7073676422`](https://github.com/objectstack-ai/objectstack/issues/32004#issuecomment-7073676422), item ② = C). `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by an authorized approval or the maintainer's merge of the PR that carries it, and is in force from that merge. **This record declares; it implements nothing** — no schema key, no engine code, no route, no changeset; every mechanism below lands through a build card ([Execution](#execution-after-acceptance)). **Four points go past the ruling's words**; each is marked ▲ where it stands and all four are listed in [Points the ruling does not settle](#points-the-ruling-does-not-settle). One of them, ▲3, asks the maintainer to scope item ③ of the same batch.

- **Date**: 2026-11-26
- **Card**: [#36253](https://github.com/objectstack-ai/objectstack/issues/36253) (p2, `area:data`). Its rule, as the card carries it:

  > An object declares the states in which it and its `master_detail` lines refuse add, edit, remove and move: for example approved, paid, closed. Approval, payment and closing only set the state. A record leaves the closed state only through a sanctioned action that moves it back. The runtime refuses changes to a closed record and its lines at every door, with one loud refusal.

  The card asks this record to settle four things: the key's shape on the object; the unit; the exemptions and whether a closed document may be deleted; one lock read for both producers. [D1](#d1--the-key-closedstates) to [D10](#d10--where-it-is-enforced-and-how-it-sits-beside-the-mechanisms-that-exist) answer them.
- **Decided by**: the maintainer, 2026-11-22, in one batch, verbatim and untranslated: 「① A ② C ③ C ④ A ⑤ A」. The ruling record states item ② as a rule:

  > **A decided document:** the object declares the states in which it and its lines are closed to change. Approval, payment and closing only set the state. A Feature and ADR card carries this.

  This record is that card's ADR. It executes item ②. It re-opens none of items ①, ④ and ⑤. It meets item ③ at one point, ▲3 in [D4](#d4--what-a-closed-unit-refuses-and-when-it-is-judged), and there it asks the maintainer whether that item reaches the lock this record declares.
- **Rulings that stand beside it**: item ① of the same batch and the 2026-11-19 「一起锁」 ruling (a record held by a pending approval locks its lines with it, with no switch); item ④ (entering a state machine from an empty state is an entry, into an initial state); item ⑤ (an elevated server context never crosses the organization wall). ⛔ None of these is re-opened here. Item ③ is quoted as the ruling record words it, because ▲3 turns on its words:

  > **A lock that reads its own field:** it holds if its condition is true before or after the write. No new publish check is added.
- **Builds on**: [ADR-0019-approval-as-flow-node](./0019-approval-as-flow-node.md) (the pending-approval record lock, whose unit and whose refusal this record shares), [ADR-0020](./0020-state-machine-converge-and-enforce.md) (the state field and its legal moves), [ADR-0034](./0034-transactional-writes-and-ambient-transaction.md) (the unit of work a write runs in), [ADR-0035](./0035-config-driven-master-detail.md) and [ADR-0055](./0055-master-detail-controlled-by-parent.md) (a `master_detail` line belongs to its master), [ADR-0049](./0049-no-unenforced-security-properties.md), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) and [ADR-0078](./0078-no-silently-inert-metadata.md) (a declared key is enforced and proven to run, or it is not declared), [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (coded refusals and their emitters), [ADR-0124](./0124-server-enforces-client-is-courtesy.md) (the server enforces; the client's gating is a courtesy), [ADR-0148](./0148-recycle-bin-separate-store-restore-under-original-ids-retention-in-days.md) (delete, the recycle bin and restore).
- **Leaves unchanged**: the pending-approval lock's write side, as it stands on `main` (the record lock, the line lock, the delete that lands and cancels the request); the approvals-family lock read, with its routes, its contract members and its published answer; `readonlyWhen`, in every respect; the `state_machine` validation rule; the `userActions` display predicates; every permission grant. Nothing in this record changes what an object that does not declare the new key does.
- **Inputs**: every code and docs text cited below was read on `objectstack-ai/objectstack` `main` at `6c290d3af7`, the commit this record's branch starts from. Positions are in [Readings](#readings-taken-at-6c290d3af7).

---

## Provenance

Three kinds of statement appear below, and they are kept apart.

- **Ruled.** The quoted rule of item ② and the four rulings that stand beside it. This record adds nothing to them and takes nothing away. It puts one question to them: whether item ③ reaches a record-level lock (▲3).
- **This record's decisions.** D1 to D10. Where a decision only spells out what the ruling's words already require, it carries no mark. Where it chooses among readings the ruling leaves open, it is marked ▲ and the alternative is recorded in [Alternatives considered](#alternatives-considered). The maintainer's merge adopts the marked points with the rest; until then they are proposals.
- **Readings.** What the code and docs do today, each with the place it was read at the commit above. A reading is a dated fact, not a decision.

One premise of the card was not checked: the card names "a hosted app's edit guards" as a producer beside approvals. That app's code is outside this repository and was not read. This record relies on it only as the card states it.

## TL;DR

- An object may declare **`closedStates`**: for one or more of its state fields, the values in which a record of that object is closed. Nothing is stored for it; a record is closed when its stored state says so.
- A closed record **and its direct `master_detail` lines** are closed to change. This is the same unit the pending-approval lock holds.
- **Every caller is bound**, at every door, whatever grants it holds, and so is a write that names no principal. The state field itself is frozen with the rest. ▲ **A system context is not bound**: the platform's own services, and the app's own elevated automation (an action body, a flow or hook that runs as system). That automation is how a closed document is reopened or moved on.
- ▲ **A closed record is not deleted by a caller**, and a delete whose cascade would reach a closed record or a line of one is refused whole.
- ▲ The lock is judged on **the row as stored when the write reaches it**. The write that closes a record lands whole; the next one is refused. Item ③ of the batch, read onto this lock, would refuse the closing write too. The maintainer scopes it.
- The refusal is the one clients already handle, **`409 RECORD_LOCKED`**, with its own sentence. It is given only to a caller who could otherwise have made the write.
- ▲ **One lock read**, owned by the data layer, answers for both producers, and says which one holds to a caller who may read the state. The approvals-family read stays as published and answers for approvals only.
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
| Who passes | a system context (`session.isSystem`); the flow run that opened the request; a write that carries only the approval's status mirror field | nobody: a system context does **not** pass, and only a value a hook derived inside the same write survives |
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
- **Asked of the store, not listed.** Closed is a predicate over a row's own stored columns. So "does this write reach a closed row" is one existence probe the store can answer: the write's own predicate, as the engine has composed it with the caller's row scope, joined to the closed predicate, and for a line object the same through a semi-join to the master. Prime Directive 5 asks for that shape first, and it is the shape the build takes. A predicate update on `main` reads its rows only when something asks for them (`packages/objectql/src/engine-update.ts#readPriorRows`), and this lock is not to become the reason every predicate write lists its rows. A store that cannot run the line probe as one statement is answered from that same read of the matched rows, taken once and under the bound the engine already sets on it (`#assertBulkPerRowHookBudget`): the read that exists, not a second path built for parity. A many-row create of lines asks once, for the masters it names.
- **What cannot be judged is refused.** With the probe in place three cases remain: a predicate write on a store that cannot run the probe and whose matched rows pass that bound; a line write that names its master by something the engine cannot read as one id; and a read of the state that fails. Each is refused, and none is taken for open. The pending line lock is narrower: it refuses a write it cannot resolve only while some record of that master object is held by a locking request. This lock does not copy that condition. Its test is the declaration: the master object declares closed states.
- **Creating a record in a closed state is not this lock's question.** Whether a record may be born `paid` is the state field's own rule: `initialStates` on its `state_machine`, and item ④ of the batch.

▲ **The lock is judged on the row as stored when the write reaches it**, inside the unit of work the write runs in ([ADR-0034](./0034-transactional-writes-and-ambient-transaction.md)).

- The write that takes an open record into a closed state **lands whole**, with whatever other fields it carries. The record was open when the write began, and the same caller could have made the same edits one write earlier.
- The road **into** a closed state is not guarded here. Who may set `status` to `paid`, and from where, stays with the field's permissions, the `state_machine` rule and the app's own actions.
- Inside one unit of work, order matters: once the closing write has landed, a later write in the same unit meets a closed record. A save that edits lines and closes the document writes the lines first. The console's master-detail save puts the header first today (`ui/packages/plugin-form/src/masterDetailTx.ts`); its build card orders a closing header write last.

**This is where the record meets item ③ of the batch.** The ruling record words that item: "A lock that reads its own field: it holds if its condition is true before or after the write." The closed-state lock reads the state field and freezes it, so by those words it may be such a lock. If it is, the rule above is not the ruled one: the lock would also hold on a write whose *result* is closed, and a caller's write that closes a record would be refused whole, as a write to a closed record is. This record cannot scope a ruling, and it does not claim that item ③ stops short of a record-level lock. It proposes the stored-row rule, sets out in [Alternatives considered](#alternatives-considered) what each reading does to an app, and asks the maintainer for the scoping at ▲3. Whatever is decided there, `readonlyWhen` keeps item ③'s rule, and an object that carries both locks gets both.

### D5 — Who is bound: every caller; a system context is not

**The test.** A write is bound unless it is made in a system context: the mark only server code can set, carried to the write as `isSystem` (`packages/objectql/src/engine-execution-plumbing.ts#buildSession`). The tree has three kinds of writer, and the test sorts all three.

- **A caller's context is bound, at every door.** The data API and its batch forms, a page or grid in the console, an API key, an AI agent acting for a principal, and automation that acts as the caller: a flow that runs as the user, which is a flow's default, and a hook that runs as the user or inherits the context of the caller's write, which is a hook's default.
- **A write with no principal and no system mark is bound.** A programmatic call that passes no context, and a schedule-started flow that runs as `user` and so has no user to run as, reach the engine with no session at all. No identity is not an elevated identity. The pending lock applies the same test, and so do the showcase's hooks. Code that means to write a closed document as the platform says so by running as system.
- ▲ **A system context is not bound** (below).

Three things follow for a bound writer.

- **No grant opens a closed record.** No permission set, no `modifyAllRecords`, no administrator role. The pending lock has no such exemption either; an administrator who must change a closed document uses the app's own action for it, as below.
- **The state field is frozen with the rest.** A caller cannot reopen a closed record by editing its state. If it could, the lock would be one edit deep.
- **Two passes of the pending lock do not carry over.** The pending lock also lets through the flow run that opened the request, and a write that carries only the approval's status mirror field. A closed state has no run that owns it, and its state field is frozen. So a write to the record by a node that follows an approval decision, in a flow that runs as the user, is refused once the approval's outcome is a declared closed state. Those nodes are the commonest automation to write a document just after it is decided, and [Consequences](#consequences) says what the author does about it.

▲ **Not bound: a write made in a system context**, the context no client can assert for itself.

- **The platform's own services**: the approval status mirror (`packages/plugins/plugin-approvals/src/approval-service.ts#mirrorStatusField`), summary recompute (`packages/objectql/src/engine-summaries-and-expansion.ts#recomputeSummaries`), retention, an import or seed that runs as system.
- **The app's own elevated automation**: an action body (`packages/runtime/src/action-execution.ts#buildActionExecutionContext`), and a flow or hook declared `runAs: 'system'` (`packages/spec/src/automation/flow.zod.ts#runAs`).

This is how the card's sentence is met: "a record leaves the closed state only through a sanctioned action that moves it back". "Refund", "Void", "Reopen for correction" are actions the app ships, each with its own gate on who may run it; the action's body sets the state, and an open record is an ordinary record again. An app that ships no such action, and no system automation that moves the state, gives its users no way to reopen, and that is a legitimate product.

**One platform service moves a state with no app action behind it: the approval status mirror.** It writes `pending` to the mirror field when a request opens on the record, and the request's outcome after that: approved, rejected, returned or recalled, each where the field's options declare the value; a recall on a field that declares no `recalled` value puts back the value the field had at submit (`packages/plugins/plugin-approvals/src/approval-service.ts#mirrorStatusField`, `#mirroredStatusValue`). A record that is closed on its mirror field therefore leaves the closed value when a new approval round opens on it. This record keeps that path and names it: a new approval round is a sanctioned way out, and the app controls it at the flow's entry, by who may start the flow and from which states. An author who does not want a decided document sent round again gates the flow's start on the state, or closes on a business state the mirror does not write.

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
- **What the sentence may name.** The closed document, by its object's label and its title. The title is the one the writer would be served: picked from the row under the writer's own field-level security, the way the pending lock picks its title (`packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#recordTitleOf`, `#writerEnvelope`). A display field the writer may not be served gives no title, and the sentence takes the label form. ⛔ Never the title as stored. For a line write it names the master and takes the label-only form, as the pending line lock does: the engine reads the master's state to judge, and reads nothing of the master to word the refusal. The sentence never carries a record id, an API name, or the state's value: a reader who may see the state reads it off the record.
- **What the refusal tells, and to whom.** That the document is closed, to a caller who could otherwise have made the write ([D10](#d10--where-it-is-enforced-and-how-it-sits-beside-the-mechanisms-that-exist)) and to nobody else. Where an object declares one value on one field, "closed" is one bit of that field, and a writer who may change the document but may not read the field learns it. That is accepted: a refused writer is owed the true reason, and the pending lock's "wait for the approval" would be false. The read is held to a tighter line ([D9](#d9--one-lock-read-owned-by-the-data-layer)).
- **The upload-link door words its own refusal.** It answers `RECORD_LOCKED` in a sentence of its own, in every locale it carries, and that sentence says an approval is in progress (`packages/services/service-storage/src/upload-link-copy.ts`). It gains a closed-state sentence beside it.
- **The refusal does not say which lock.** Both locks answer the same code, and nothing machine-readable in the refusal names the producer. A client that must tell them apart asks the lock read. Whether the refusal's body should carry the reason is left open ([Points the ruling does not settle](#points-the-ruling-does-not-settle)).
- **When both locks hold**, either refusal is correct and both carry the same code. The closed-state judgement runs before the before-phase hooks ([D10](#d10--where-it-is-enforced-and-how-it-sits-beside-the-mechanisms-that-exist)), so the closed sentence is the one the writer sees.

### D9 — One lock read, owned by the data layer

▲ There is one read that answers "is this record locked" for both producers. It is owned by the data layer, and every first-party door that asks reads it.

```ts
// For one record, as the caller. `null`: the caller cannot read the record, or it does not exist.
{ locked: boolean; lockSource?: 'record' | 'master'; lockReason?: 'closed_state' | 'approval' } | null
```

- **Two producers, both named here.** The engine's own closed-state judgement, and the approvals plugin's pending-request judgement (the one behind today's `getRecordLock`). The read composes them. A third producer is a new decision, not a registration: the seam between the engine and the approvals plugin is internal.
- **It exists without the approvals plugin.** An app that installs no approvals still declares closed states and still has a lock read.
- **`locked` means locked for a caller** ([D5](#d5--who-is-bound-every-caller-a-system-context-is-not)). The read does not answer for system contexts.
- **`lockReason` says which producer holds.** A client words its banner from it: "in approval" and "closed" are different things to tell a user. It is the one member this read adds to the answer the approvals contract publishes.
- **`lockReason` follows the state field's read permission.** `closed_state` is a statement about a field: where one value of one field is declared it *is* that field's value, and on a line it is one bit of the master's state. So the reason is given only to a caller who may read every state field the answer could rest on: the fields the record's own declaration names and, for a line, the fields its master's declaration names. Any other caller gets `locked` and `lockSource` with no reason, **whichever producer holds**, so that a missing reason says nothing. `locked` itself goes to every caller who can read the record. It is the fact the read exists to tell, that an edit will be refused, and it is what the refusal would tell. This is the line [D8](#d8--the-refusal) draws for the state's value in the refusal's sentence, applied to the read.
- **`lockSource` says whose lock it is, and its delete reading belongs to approvals.** `'record'`: the record's own state, or its own request. `'master'`: its master's. The approvals contract also reads a delete rule off this member: a record held on its own "may still be deleted", a line of a held master may not (`packages/spec/src/contracts/approval-service.ts#getRecordLock`), and the console's grid keeps or drops Delete by it (`ui/packages/plugin-grid/src/objectGridActionsColumn.tsx`). On this read that rule holds **only under `lockReason: 'approval'`**. Under `closed_state` a caller's delete is refused for either source ([D6](#d6--a-closed-record-is-not-deleted-by-a-caller)). A client reads the reason first. An answer with no reason promises nothing about delete, and there the server's own refusal is the answer.
- **One answer when several hold.** The reason is chosen first, `closed_state` before `approval`; within a reason, `master` before `record`, which is today's rule. A closed document with a stale pending request reads as closed.
- **What it never carries.** Which field or value closed the record, a request id, or participants. The same disclosure line the read has today.
- **Readable means what it means today, door by door.** The read is made as the caller; a record the caller cannot read answers `null`, the same as a missing one. The approvals contract keeps two readability anchors on purpose, one for the single read and one for the page read (`packages/spec/src/contracts/approval-service.ts#getRecordLocks` records the difference and the seat ruling behind it). Each form of this read keeps the anchor of its counterpart, and this record aligns neither. The page form keeps today's bound of 200 ids (`#APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS`).
- **Doors.** The data family gains the read for one record and for a page of records, with SDK methods beside the other data reads. The exact path spelling is the build card's.
- **The approvals-family read stays exactly as published.** Its two routes, their SDK methods and `IApprovalService.getRecordLock` / `getRecordLocks` go on answering the question their contract words, whether a record is held by a locking approval, with `lockSource` and its delete reading as published. They do not answer for closed states. Serving them from the new read would widen a published answer, and would hand a closed record's `lockSource: 'record'` to clients that read it as "may still be deleted". The seat ruling that contract records (7152650156) declined to narrow a published answer on this read; widening one is the same kind of change, and it is not made here in passing. A client that asks only the approvals read is told nothing about closed states, and the server's refusal is its answer (ADR-0124). Retiring those routes, or redirecting them, is not decided here.
- **First-party askers move to the one read.** The console's record page, grid and line grid, and the upload-link door that asks before it issues a link. The record page's approvals part keeps its `lock` as the approvals producer's answer (`packages/rest/src/record-page-routes.ts#answerApprovals`).

The pending lock's write side is untouched. One read for both producers, two enforcers: the engine for closed states, the approvals plugin's hooks for pending requests.

### D10 — Where it is enforced, and how it sits beside the mechanisms that exist

- **In the engine's write path.** Not in an optional plugin and not in a hook an app could forget: a declared `closedStates` is enforced wherever a record of the object can be written (ADR-0049, ADR-0078). The key and its enforcement ship in the same release, and the showcase conversion is the runtime proof ADR-0054 asks for.
- **Only for a write the caller could otherwise make.** The judgement comes after the gates that decide whether this caller may make this write at all: the object's permission and the row's access. A caller those gates refuse gets exactly the answer an open record gives, and a predicate write is judged only over the rows the caller's own scope reaches. A closed record never answers differently from an open one to a caller who could not have written it. The same holds for a line. The engine reads the master's state itself, so the verdict does not depend on the writer's read grants on the master, and it reads it only once the line write has passed its own gates.
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

1. **The key and its enforcement, released together.** The spec key with its authoring refusals, form row, reference docs and liveness proof ([D1](#d1--the-key-closedstates)); the engine's judgement on update, delete, line writes, many-row writes through the store's probe, the cascade set and restore, placed behind the permission and row-access gates ([D2](#d2--closed-is-read-off-the-stored-row-nothing-is-stored-for-it) to [D7](#d7--writes-that-are-not-a-callers-change), [D10](#d10--where-it-is-enforced-and-how-it-sits-beside-the-mechanisms-that-exist)); the ledger row, the sentence family in every locale, and the upload-link door's own closed-state sentence in every locale that door carries ([D8](#d8--the-refusal)). One PR or a stacked pair, but the key is never published without its enforcement (ADR-0078). `Metadata-protocol: added`.
2. **The one read.** The engine's read, the internal seam the approvals producer answers through, the reason's read-permission rule, the data-family routes and SDK methods, and the first-party askers moved ([D9](#d9--one-lock-read-owned-by-the-data-layer)). The approvals-family routes and contract members are not touched.
3. **The showcase conversion — the proof.** The three paid-invoice line hooks are deleted and the invoice declares `closedStates`. The card records, as a dogfood run against the running app, each refusal the hooks gave before and the declaration gives after, and every outcome that changes by design:
   - a caller's edit of a paid invoice's header is refused, where today every field but the one that carries `readonlyWhen` lands;
   - a caller's delete of a paid invoice is refused, where today only the button is hidden;
   - a caller's update of a line under a paid invoice is refused whole, where today a change to `description`, `position`, `service_start` or `receipt` lands, and a write that carries `product`, `quantity` or `unit_price` has those keys stripped and the rest lands;
   - adding, moving and removing a line under a paid invoice stay refused, now with the platform's code and sentence where the app worded three of its own.
4. **The console.** The record page, the grid and the line grid read the one read and word the reason, or a plain lock where no reason is given; edit is greyed on a locked record and delete hidden where the read says `closed_state`, without per-object predicates; the master-detail save writes a closing header last ([D4](#d4--what-a-closed-unit-refuses-and-when-it-is-judged)).
5. **Docs.** The approvals guide's "the record unlocks" passages gain a pointer to closed states; the data-modelling guide documents the key, with the authoring notes of [Consequences](#consequences).

Three things the build verifies and pins, because this record read them but did not run them:

- The approval status mirror is written after the request is finalised, and a failure of that write is logged and swallowed (`packages/plugins/plugin-approvals/src/approval-service.ts#mirrorStatusField`). Where the mirrored value is a declared closed state, the document is open between the two writes, and stays open if the mirror fails. The engine card measures whether both writes share one unit of work and reports what it finds; changing the approvals plugin's behaviour is a card of its own.
- Which engine-derived writes reach a closed record, and in which context each runs ([D7](#d7--writes-that-are-not-a-callers-change)).
- Whether a customization overlay may add `closedStates` to an installed package's object, and that it may not shorten a package's own list, under the overlay rules in force when the spec card is built. If the answer changes what a subscriber can do to a packaged document, it comes back as a decision card.

## Points the ruling does not settle

The ruling says the object declares the states and that the record and its lines are closed to change. Four decisions above choose among readings it leaves open. The maintainer's merge adopts them; each can be struck without touching the rest.

| ▲ | Decision | What it means for a user | The other reading |
|---|---|---|---|
| 1 | [D5](#d5--who-is-bound-every-caller-a-system-context-is-not): a system context is not bound at all, where the card's words require only a sanctioned action that moves the state | A user, an administrator included, cannot edit or reopen a closed document by hand. The app's own actions and system automation can, and they can also change a closed document without reopening it. A new approval round on a document closed on its approval field moves it on as well. | Elevated automation may move only the state, and must reopen a document before changing it. |
| 2 | [D6](#d6--a-closed-record-is-not-deleted-by-a-caller): a caller cannot delete a closed record | Delete is refused on a closed document, where a pending one can still be deleted. | Delete lands with its lines, as under the pending lock. |
| 3 | [D4](#d4--what-a-closed-unit-refuses-and-when-it-is-judged): judged on the stored row only. **This departs from item ③ of the batch if that item reaches a record-level lock, and the maintainer is asked to scope it.** | A user can close a document by setting its state, and "edit and mark paid" in one save works; an edit after that does not. Inside one save, the closing write goes last. | Item ③ applies: the lock also holds when the write's result is closed. A user can then neither leave nor enter a closed state by an edit. Only an action, system automation or the approval mirror closes a document, and an app that closes by hand ships an action first. |
| 4 | [D9](#d9--one-lock-read-owned-by-the-data-layer): a new read owned by the data layer answers for both producers and names the reason; the approvals-family read stays as published and answers for approvals only | The console can tell "in approval" from "closed", with or without the approvals plugin. A client that still asks the approvals read is not told about closed states, and meets the server's refusal. | Serve the approvals routes from the new read and accept that their published answer widens. Or keep the read in the approvals plugin and add a second read for closed states. |

Left open on purpose, each a later decision if it is ever wanted:

- **Ownership transfer of a closed document.** It is an update of the record, so a caller's transfer is refused; a system context transfers. If day-to-day reassignment of closed documents proves necessary, exempting the ownership field is an amendment to D5.
- **Fields that stay editable on a closed record** (a note, a tag). Not offered. An app that needs it keeps the field on a satellite object.
- **Deeper levels of lines.** One level, as the pending lock ([D3](#d3--the-unit-the-record-and-its-direct-master_detail-lines)).
- **State fields that are not a `select`** (a boolean "posted"). Not admitted by [D1](#d1--the-key-closedstates).
- **Retiring the approvals-family lock routes, or redirecting them to the one read.**
- **A reason in the refusal's body.** The refusal carries one code for both locks ([D8](#d8--the-refusal)). If a client ever needs the producer from the refusal itself, the member follows the rule `lockReason` follows on the read.

## Consequences

**What gets better**

- "This document is closed" is one line on the object. New fields and new line objects are covered without anyone remembering them.
- The server enforces it at every door. A hidden button and a refused write now say the same thing.
- A client asks one question, gets one answer, and can word it.
- The showcase loses three hooks and gains a declaration that any app can copy.

**What an author has to know**

- **Publishing a declaration closes existing records at once** ([D2](#d2--closed-is-read-off-the-stored-row-nothing-is-stored-for-it)). There is no grace period and no backfill to wait for.
- **Automation that acts as the caller is refused on a closed record.** A flow that runs as the user and stamps a field after the document closes fails with `RECORD_LOCKED`. Either the stamp belongs in the write that closes the document, where a before-phase hook can derive it, or the flow is declared to run as system. The same holds for a hook that writes back to the record after it closed.
- **That includes the steps after an approval decision.** Where the approval's outcome is a declared closed state, the document is closed the moment the decision is mirrored, and the flow's next node meets a closed record. The pending lock let the run that opened the request write on; this lock does not. An author who closes on the approval's outcome declares that flow to run as system, or closes on a later state that the flow's own last node sets.
- **A new approval round reopens a document that is closed on its approval field.** The mirror writes `pending` when the round opens, where the field declares that value ([D5](#d5--who-is-bound-every-caller-a-system-context-is-not)). An author who does not want that gates the flow's start on the state.
- **Code that calls the engine with no context is bound like a caller.** To write a closed document as the platform, it passes a system context.
- **Elevated automation is not bound.** An action body that updates a field does so on a closed record too. An author who wants an action to respect the closed state gates the action on the state.
- **The way out is an action.** An app that wants users to reopen, void or refund ships the action and decides who may run it.
- **Line edits go before the closing write** when both travel in one save. A create has no such order: a caller cannot create a document that is already closed together with its lines, because each line would be added under a closed master. The caller creates it open, adds the lines and closes it last; a load of finished documents runs as system.
- **The lock's reason follows the state field's read permission.** A user who may read a document but not its state field is told it is locked, and not why.

**What it costs**

- A write to a line reads its master's state fields, and a predicate write to a declaring object or its lines costs one existence probe. A write to an object that neither declares the key nor is a line of one reads nothing extra.
- There are two lock reads for as long as the approvals-family one is kept: the one read, with a seam between two packages behind it, and the approvals read that answers for approvals only. A client that asks only the second offers edits on closed documents, and the server refuses them.
- A caller who may not read the state field gets a lock with no reason, and for that caller a client cannot say in advance whether a delete will be refused.
- Three outcomes change in the showcase when it converts, and three refusals change their words ([Execution](#execution-after-acceptance), item 3): a caller can no longer edit a paid invoice's header, delete a paid invoice, or change any field of a line under one. No platform default changes; an app is affected only when it declares the key.

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

- **Apply item ③ to this lock: it holds if the record is closed before the write or would be closed after it.** Then a bound writer can neither leave a closed state nor enter one. A caller's write that sets `status` to `paid` is refused whole, with or without other fields, and so is a caller's create of a record already in a closed state. Only a system context closes a document: an action body, a flow or hook that runs as system, the approval mirror, a payment service.
  - *What it buys.* No document is closed for good by a slip in a form, and the closing-write-last ordering of [D4](#d4--what-a-closed-unit-refuses-and-when-it-is-judged) has nothing left to order.
  - *What it costs.* Every app that lets a user set the closing state in a form ships an action or automation for it before it declares the key. A load of finished documents runs as system. The refusal needs one more sentence, since "this document is closed" is false of a document that is still open.
  - *Why this record proposes the stored-row rule.* The card's rule says what sets the state ("approval, payment and closing only set the state") and not who may, and the stored-row rule leaves the road into a closed state where it is governed today, with the field's permissions and the `state_machine` rule.
  - *What the other choice changes in this record.* "A caller's own edit of the state field" in [D2](#d2--closed-is-read-off-the-stored-row-nothing-is-stored-for-it); in D4 the create row of the table, the bullet on creating a record in a closed state and the three bullets under ▲; the closing-write-last items in [Execution](#execution-after-acceptance) and [Consequences](#consequences), and one more sentence in [D8](#d8--the-refusal). Nothing else.
- **Judge against the state at the start of the unit of work**, so that one save may close the header first and write its lines after. Friendlier to a client that orders its writes header-first, but it needs per-unit memory in the engine and behaves differently on a store with no transactions. Ordering the closing write last gives the same result with no new mechanism.

**The read** (▲ 4)

- **Keep the read in the approvals plugin and have it ask the engine.** An app without approvals would then have closed states and no way to read them.
- **Two reads, one per producer.** Every client would have to call both and combine them, and each new door would have to remember the second.
- **Serve the approvals-family routes from the one read.** Kinder to a client that has not moved: it would grey Edit on a closed document. Not chosen because it changes what a published answer means. That read is documented as "held by a locking approval", and its `lockSource: 'record'` as "may still be deleted", which is false of a closed record ([D9](#d9--one-lock-read-owned-by-the-data-layer)). The maintainer may choose it; the cost is that published contract's wording and every client that reads `lockSource` alone.
- **Give the reason to every reader of the record.** Simpler, and a client could always tell whether a delete will be refused. Not chosen because the reason is a statement about the state field, and a field's read permission is the line this platform already holds for a refusal's title and for the state's value.

**The status quo — each app writes its hooks.** That is the "B" of the earlier ruling, taken until a producer beyond the showcase was named. The 2026-11-22 ruling names them.

## Readings, taken at `6c290d3af7`

| What was read | Where |
|---|---|
| The pending record lock: a global before-update hook; passes a system session, the run that opened the request, and a write that carries only the status mirror field; no administrator exemption; refuses `RECORD_LOCKED`, 409 | `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindApprovalLockHook`, `#lockedError` |
| The pending line lock: insert, update, delete and move under a held master are refused; the cascade leg of the held master's own delete yields; a write whose master cannot be resolved is refused only while some record of that master object is held by a locking request | `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindDetailRowLockHook`, `#soleCascadeEdgeOf`, `#inOpenUnit` |
| The pending lock titles its refusal from the row as served to the writer; a display field the writer may not be served gives no title | `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#recordTitleOf`, `#writerEnvelope` |
| Deleting a record with a pending request lands and cancels the request | `packages/plugins/plugin-approvals/src/lifecycle-hooks.ts#bindRecordDeleteCancelHook` |
| The lock read's contract, its answer, its `null`, its page bound; `lockSource` carries a delete reading (a record held on its own "may still be deleted"); the single read and the page read keep different readability anchors on purpose | `packages/spec/src/contracts/approval-service.ts#getRecordLock`, `#getRecordLocks`, `#APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS` |
| The two approvals-family lock routes | `packages/rest/src/rest-route-ledger.ts` |
| The record page composes the lock into its approvals part, as `locked` alone | `packages/rest/src/record-page-routes.ts#answerApprovals` |
| The console's two readers of the lock | `ui/packages/app-shell/src/hooks/useRecordApprovals.ts`, `ui/packages/plugin-grid/src/hooks/useRowApprovalLocks.ts` |
| The grid keeps Delete on a row held by its own approval and drops it on a row held through its master | `ui/packages/plugin-grid/src/objectGridActionsColumn.tsx` |
| "The record unlocks" on a decision | `content/docs/automation/approvals.mdx` |
| The status mirror: written after the request is finalised, in a system context; a failure is logged and swallowed. It writes `pending` when a request opens and the outcome after, each where the field's options declare the value | `packages/plugins/plugin-approvals/src/approval-service.ts#mirrorStatusField`, `#mirroredStatusValue` |
| `readonlyWhen`: strips a caller-supplied value; a system context is deliberately not exempt; a hook-derived value survives | `packages/objectql/src/validation/rule-validator.ts#stripReadonlyWhenFields`, `#isCallerSuppliedValue` |
| The referential clear and the restore re-link are exempt from the read-only strips | `packages/objectql/src/validation/rule-validator.ts#ReferentialClearExemption` |
| The `state_machine` rule: `field`, `transitions`, `initialStates` | `packages/spec/src/data/validation.zod.ts#StateMachineValidationSchema` |
| `userActions` predicates are "advisory UI gating only" | `packages/spec/src/data/object.zod.ts` |
| No `closedStates` key, or any key of that meaning, exists on the object schema | `packages/spec/src/data/object.zod.ts` |
| A delete collects its whole cascade set, then judges in-cascade `restrict`, then writes | `packages/objectql/src/engine-cascade-planning.ts#cascadeDeleteRelations` |
| A predicate update reads its matched rows only when something asks for them, once, and bounds the per-row fan-out | `packages/objectql/src/engine-update.ts#readPriorRows`, `#assertBulkPerRowHookBudget` |
| A condition on a related record is lowered to an in-database subquery on a read, and to a bounded id list elsewhere | `packages/objectql/src/relation-filter-lowering.ts` |
| Prime Directive 5: a query capability is built at its fastest SQL shape first | `AGENTS.md` |
| A context that says nothing about the caller yields no session; the system mark rides the session as `isSystem` | `packages/objectql/src/engine-execution-plumbing.ts#buildSession` |
| Summary recompute writes the master in a system context | `packages/objectql/src/engine-summaries-and-expansion.ts#recomputeSummaries` |
| Restore writes rows back through the driver, with no insert hook | `packages/objectql/src/recycle-bin/restore.ts` |
| An action body runs elevated | `packages/runtime/src/action-execution.ts#buildActionExecutionContext` |
| A flow's `runAs` defaults to the user | `packages/spec/src/automation/flow.zod.ts#runAs` |
| `RECORD_LOCKED` is registered for the approvals plugin and for the upload-link door | `packages/spec/src/api/error-code-ledger.zod.ts` |
| The upload-link door asks the approvals lock before it issues a link, and words its `RECORD_LOCKED` refusal itself, in every locale it carries | `packages/services/service-storage/src/record-file-access.ts`, `packages/services/service-storage/src/upload-link-copy.ts` |
| The pending lock's end-user sentence and its four forms | `packages/spec/src/system/operation-message.ts#record_locked` |
| The showcase: three paid-invoice line hooks, each passing a system session and each refusing in a sentence of its own; `readonlyWhen` on three line fields (`product`, `quantity`, `unit_price`) and on one header field; display predicates on the header | `examples/app-showcase/src/data/hooks/index.ts#GuardPaidInvoiceLineAddHook`, `#GuardPaidInvoiceLineMoveHook`, `#GuardPaidInvoiceLineRemoveHook`; `examples/app-showcase/src/data/objects/invoice.object.ts` |
| The console's master-detail save writes the header as its first operation | `ui/packages/plugin-form/src/masterDetailTx.ts`, `ui/packages/plugin-form/src/MasterDetailForm.tsx` |

Not read: the hosted app the card names as a producer ([Provenance](#provenance)).

## Refs

- Card [#36253](https://github.com/objectstack-ai/objectstack/issues/36253); ruling record [`7073676422`](https://github.com/objectstack-ai/objectstack/issues/32004#issuecomment-7073676422) on #32004.
- The earlier ruling "C, so B now": record [`6281609466`](https://github.com/objectstack-ai/objectstack/issues/24684#issuecomment-6281609466) on #24684; the showcase hooks landed in PR [#24731](https://github.com/objectstack-ai/objectstack/pull/24731).
- The lock read for lines: PR [#36135](https://github.com/objectstack-ai/objectstack/pull/36135).
