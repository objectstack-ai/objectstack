---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/service-automation': patch
---

`AutomationContext` declares `callerParamKeys?: string[]` — the flow doors say which `params` keys the caller supplied, and a `screen` node reads that instead of inferring it (#19846).

Clause-②: yes

A screen whose fields the run's caller already supplied continues without pausing (#15787). Deciding "did the caller supply this field?" from the params bag was an inference: the bag a flow receives also holds the subject record's columns and the launched row's id, which the door seeds itself. Two constructions still skipped a screen that should have paused — both a non-default `recordIdField` with a `recordIdParam` naming a key the record lacks, on an object-less action whose record has a `recordId` column, or on an object-bound action whose record shadows `recordId` and the `<object>Id` alias. Maintainer ruling on #15705, verbatim: 「15705同意」.

**What the key says.** The keys of the caller's own `params`, recorded before the door seeds anything. An empty array means the caller supplied nothing; an absent key means the producer does not say.

**Who fills it.** The action door (`dispatchFlowAction`: `POST /api/v1/actions/...` and MCP `run_action`) and the trigger door (`buildAutomationContext`: `POST /api/v1/automation/:name/trigger`, the legacy `POST /api/v1/automation/trigger/:name`, and a declarative `type: 'flow'` endpoint). Record-change, schedule, time-relative and webhook triggers, and code calling `execute` directly, leave it absent. `subflow` and `map` nodes drop the parent's list from the child run's context, because it describes the parent's bag.

**What the screen does with it.** When the key is present, a field is caller-supplied when its name is in the list and `params` holds a value for it; the inference is not consulted. A present value that is not an array names nothing, so the screen pauses. When the key is absent, the inference from #15787 applies unchanged.

**Accepted cost, precisely:** both doors leave out of that list the keys they use to carry the launched row's id — `recordId`, the camelCase `<object>Id` alias, and on the action door the action's own `recordIdParam` — even when the caller's bag names them, because a client that mirrors the row id into `params.recordId` is addressing the row, not answering the screen. On a run started through either door, a field named like one of those keys is therefore not caller-supplied: a required such field is collected interactively, and an optional one does not count as answering the screen.

**What moves for a headless caller, through either door:**

- the two constructions above pause instead of skipping;
- a field whose value equals a column of the subject record, or equals the row id, now counts as supplied when the caller named it — the inference could not tell those from the seeds and paused;
- a field named like the action's `recordIdParam` no longer counts as supplied when the caller sent that key with a value other than the row id — the inference counted it; the door now treats that key as the row-id channel.

Nothing moves for an implementation of `IAutomationService`: the key is optional, and a context without it keeps its prior meaning.
