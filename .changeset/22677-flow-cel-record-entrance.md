---
'@objectstack/lint': major
---

A flow CEL expression that reads `record` on a flow no entrance hands a record is refused at `objectstack validate`. Since #22642 the run binds `record` only to the record it was handed, so such a read fails the run with `Unknown variable: record`, and the build door still counted `record` as bound on every run and passed it.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered flow-cel-unbound-root-refused, flow-cel-record-variables-alias-retired) A record read on a flow no entrance hands a record is a root the flow does not bind, which is the surface of the D3 entry flow-cel-unbound-root-refused (protocol 18, not yet released); this diff corrects that entry's reason to say so. The runtime half is the D3 entry flow-cel-record-variables-alias-retired (#22642). Both exist at the merge base and neither has shipped, so this narrowing adds no entry. -->

**BREAKING**: an accept-set narrowing on a published authoring surface (`objectstack validate`'s `expression-invalid` rule).

**What is refused.** `record` is no longer one of the roots the build door binds on every run (`previous`, `vars` and `current_user` still are). It is bound where:

- an entrance the stack declares hands the flow a record: a record trigger (start `config.triggerType` is a `record-*` token), a time-relative sweep (start `config.timeRelative`), the inbound hook (trigger kind `api`), a `type: 'flow'` action that targets the flow (on any object, or on none), a `map` node with a `config.itemObject` that names the flow, or a `subflow` / `map` parent that is itself handed a record;
- or the flow binds a variable named `record` itself (a declared variable or an `assignment` target).

A start `config.objectName` alone is no entrance: with no `record-*` trigger nothing hands the run a row. A parent's own `record` variable is not handed on either: a child gets its parent's context, not its variables. Everywhere else `record.X` is refused as `expression-invalid`, `error`, with the remedy below.

**Not judged.** The stand-downs of the unbound-root rule are unchanged. At the runtime publish gate this judgment still stands down: its per-write snapshot carries no actions and no other flows, so it cannot see an entrance, and a flow write there is not refused for `record` until that snapshot carries them.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `record.assignee` on a flow no entrance hands a record, meaning a flow variable `assignee` | `assignee`, or `vars.assignee` |
| `record.status == "open"` on a flow meant to run when a row is written | the trigger that hands it the row: start `config: { objectName: 'acct', triggerType: 'record-after-update' }` |

**The one-line fix: read a flow variable by its name or through `vars`, and read `record` only on a flow an entrance hands one.**

**Who is affected, measured.** With this judge over every flow CEL site: the example apps (`app-crm`, `app-todo`, `app-multi-package`, `app-showcase`: 35 flows, 14 that read `record`), `packages/platform-objects` (no flows) and `objectstack-ai/hotcrm` at `1d7148b` (32 flows, 14 that read `record`): 0 newly refused. Every flow that reads `record` there is a record-change, time-relative or inbound-hook flow. Deployed metadata and other repositories were not measured.

The #22642 note in this release says `objectstack validate` does not refuse such a `record` read yet. From this release it does.
