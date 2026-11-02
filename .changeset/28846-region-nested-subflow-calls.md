---
'@objectstack/service-automation': patch
---

fix(service-automation)!: the subflow guards see a `subflow` / `map` call inside a region body (#28846)

Clause-②: no (narrowing)
Metadata-protocol: none

**BREAKING** for a packaged flow that calls a packaged child from inside a `loop` body, a `parallel` branch or a `try_catch` slot.

- **Before.** The ADR-0126 §7.3 guards read a flow's calls from its top-level nodes only. A `subflow` or `map` node inside a region body was invisible to them. A packaged caller was armed onto a disabled packaged child and failed mid-run at that node, and the child could be switched off or removed while an enabled caller still called it.
- **Now.** The guards read calls at every region depth, through the spec's region walk (`collectFlowGraphs`). A packaged caller whose region body calls a disabled packaged child registers but is not armed: it warns, and `/_status` reports `unboundCause: 'disabled_subflow'` naming the child. Switching off or removing a packaged child that an enabled packaged caller calls from a region body is refused with `DELETE_RESTRICTED` (409), naming the caller. Re-arming when the child is enabled or republished `active` works as it does for a top-level call.
- **Not changed.** The save-notice half of the arming gate (#28840) still reads top-level calls only. A region cannot carry a durable pause, so a region-nested call whose child suspends fails the run at the region boundary before anything after it runs. Registration, the save door and `objectstack validate` accept the same flows as before.
- **The fix.** Enable the child, or publish it `active`, and the caller arms. To switch off or remove a child, switch off its callers first, as the refusal names.
- **Who moves.** HotCRM's `campaign_enrollment` calls two active children from loop bodies. It still arms. Switching off or removing those children while it is enabled is now refused, as it already was for a top-level call. Showcase and dogfood calls are all top-level.

<!-- adr-0087: not-required (no-migration-prescription) no metadata key is added, removed, renamed or re-shaped and the save door accepts the same flows: the runtime guards now read calls they already should have read, the remedy is an administrator's enable or a republish named in the warning and the refusal, and no migration could rewrite that choice -->
