---
'@objectstack/spec': major
'@objectstack/service-automation': major
'@objectstack/cli': patch
'@objectstack/lint': patch
---

A flow VALUE slot now refuses the run-user template token `{$User.<path>}` as well, and every CEL expression in a flow sees **`current_user`**, the run's user. `{$User.Id}` in a `create_record` / `update_record` `fields` value or an `assignment` value is refused at `objectstack validate`, at `registerFlow` and by the executor, naming `current_user.id` and, for a flow that can run without a user, its guard; every other `$User` path is refused saying it never resolved.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused, flow-text-slot-single-brace-refused, flow-text-slot-unbound-dollar-root-refused) The value-slot retirement's step-18 D3 entry, registered on this line before this change, is amended in this diff to refuse the run-user paths and name their remedies; the two text-slot entries are amended where their remedy computed the run user through the value-slot spelling this change refuses. No new D3 entry and no D2 conversion: a user-less run answers the template's nothing with null or a fault, which no conversion can make lossless. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** The template dialect is retired from the value slots, one dialect per slot, with a remedy for every spelling. The run user was the one path spelling kept, because the flow CEL scope bound no user: `current_user.id` passed `objectstack validate` and `registerFlow`, then failed the run with `Unknown variable: current_user`. The scope now binds it, so the token can be refused with a remedy that evaluates.

**What `current_user` is.** In every flow CEL expression — a start-node `condition`, an edge `condition`, a `decision` condition, a screen field's `visibleWhen`, an `assignment` or `fields` value envelope — `current_user` is the run's user, built through `createEvalUser` from what the run context holds: `id` (the run's `userId`), `positions`, `organizationId` (the run's `tenantId`) and the derived `isPlatformAdmin`. No run carries an email or a name, so neither is bound. A run with no user — a schedule, a record change made by a system write — sees `null`, never a stand-in user: `current_user.id` then fails the run loudly, and `current_user != null` can guard it. A `runAs: 'system'` run sees the user that triggered it, as `{$User.Id}` did. A flow variable named `current_user` is shadowed by the binding, as one named `vars` is by the variables namespace; both are read as `vars["current_user"]` / `vars["vars"]`, and the refusal of a `{vars.…}` or `{current_user.…}` path token prints that spelling.

**The expression remedy.** A refused `{…}` arithmetic token's CEL spelling now reads every variable path in it the way a lone path token's does — `{int * 2}` is `vars["int"] * 2`, `{items.0 * 2}` is `items[0] * 2` — instead of rewriting only its divisors, which printed envelopes that did not evaluate.

**Still accepted, unchanged.** A CEL value envelope, every literal, and the date macros `{NOW()}` / `{TODAY() ± N}` (CEL has no string form for a Timestamp yet). A string that mixes a date macro with any other token, a `$User` path included, is still kept whole. `{$User.*}` keeps resolving where the single-brace dialect still lives — a `filter` value, a `notify` `recipients` entry. The value-slot retirement's entry earlier on this line lists `{$User.<path>}` among the spellings still accepted, and the text-slot entries compute the run user through it; this entry supersedes those lines.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `'{$User.Id}'` | `{ dialect: 'cel', source: 'current_user.id' }` | nothing when the run has a user |
| `'{$User.Id}'`, in a flow that can run without a user | `{ dialect: 'cel', source: 'current_user != null ? current_user.id : null' }` — or skip the node with `current_user != null` as a start condition or a `decision` | the guarded form writes `null` where the template wrote nothing, so on `update_record` it clears a stored value the template left alone |
| `'{$User.Email}'`, `'{$User.Name}'`, any other `$User` path | an `assignment` of `uid: { dialect: 'cel', source: 'current_user.id' }`, a `get_record` on `sys_user` with `filter: { id: '{uid}' }` and `outputVariable: 'me'`, then `{ dialect: 'cel', source: 'me.email' }` | these never resolved in any shipped run: they wrote nothing |
| `'Owner: {$User.Id}'` | `{ dialect: 'cel', source: "'Owner: ' + current_user.id" }` | in a user-less run, write the hole as `(current_user != null ? current_user.id : '')` |
| a text slot's `assignments: { by: '{$User.Id}' }`, then `'By {{ by }}'` | `assignments: { by: { dialect: 'cel', source: 'current_user.id' } }`, then `'By {{ by }}'` | the text-slot remedy published earlier on this line computed the run user through the value-slot spelling this change refuses |

**The one-line fix: write `current_user.id` where you wrote `{$User.Id}`, and guard it where the flow can run without a user.**

**Who is affected, measured.** This repository's two authored value-slot sites are migrated in this change: the `examples/app-todo` quick-add screen flow (a screen flow always has a user, so the bare read) and the `os explain flow` catalog example, an `update_record` under a record-after-create trigger, which a system write fires with no user; it now gates on `current_user != null` in its start condition, so the stored value is left alone there as before. `examples/app-showcase`'s `{$User.Id}` is a `notify` `recipients` entry, which is not a value slot, and is unchanged. Other repositories and deployed metadata were not measured here.

### The kit

- **The binding.** `AutomationEngine.celScope` (`@objectstack/service-automation`); `evaluateCondition` and `evaluateValueEnvelope` take the run context as an optional last argument, which every engine site and the `assignment`, `decision`, `create_record` and `update_record` executors pass. Without one, `current_user` is `null`.
- **The refusal.** `valueSlotTemplateRefusals` / `flowNodeValueTemplateRefusals` (`@objectstack/spec/automation`); the text-slot judge's run-user remedy (`textSlotTemplateRefusal`) now computes the id with the CEL envelope.
- **The ledger.** The step-18 D3 entries `flow-value-slot-template-dialect-refused` (amended to refuse the run-user paths), `flow-text-slot-single-brace-refused` and `flow-text-slot-unbound-dollar-root-refused` (their run-user remedy). No key is removed, so there is no tombstone, and there is no D2 conversion.
- **`@objectstack/cli`.** `os explain flow`'s example writes `current_user.id` and gates on `current_user != null`.
- **`@objectstack/lint`.** `flow-bare-dollar-reference`'s hint for a bare `$name.path` in a value slot names the CEL envelope the value-slot refusal writes for it — `current_user.id` and its guard for `$User.Id`, the variable the reference names for any other — where it named `{source.id}` and `{$User.Id}`, both refused there. A text slot's hint keeps the `{{ }}` hole, and every other position keeps the single brace.
- **`@objectstack/service-automation`'s README.** Its *Expressions* section states the value-slot envelope, `current_user`, and the date macros still read until CEL can write them.
