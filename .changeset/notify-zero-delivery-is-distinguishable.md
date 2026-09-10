---
'@objectstack/service-automation': patch
---

`notify` now reports the recipients it addressed, so a run that notified nobody stops reading like a run that had nobody to notify

A `notify` node whose delivery count came back zero contributed `acted: 0` and nothing else to the run summary. A flow whose only effect-bearing node is that one then folded to `selected: 0, acted: 0, unmeasured: 0` — byte for byte the summary of a run that had nothing to notify about, and of a run whose `notify` node never executed. The run read healthy, and the only trace was a log line.

`emit()` returns `delivered: 0, enqueued: 0` on several paths, each after logging and nothing else: an audience that resolved to no recipient, a preference filter that suppressed every (recipient × channel) pair, a dedup hit, every enqueue failing. A stack with no messaging service installed lands in the same place. All of them were silent in the summary, so this is not one cause being fixed — it is the whole class becoming visible.

The node now reports `selected` — the recipient entries it addressed — on every path that reaches a recipient list, alongside the `acted` / `unmeasuredEffect` rules it already had. Those two are unchanged, so a delivering run keeps its existing `acted` (inline) or `unmeasured` (outbox) reading and stays outside the broken-sweep filter; a zero-delivery run now reports `selected: N, acted: 0` with no `unmeasured`, which is the platform's declared "matched N, acted on none, and that zero is trustworthy" signature and puts the run **inside** `selected > 0 AND acted = 0 AND unmeasured = 0` — the filter that exists for exactly this, and whose first clause the old reading could never satisfy.

The zero is deliberately NOT reported as `unmeasuredEffect`. That flag means the count is unknown; this count is known and it is zero, and claiming otherwise would take the run out of the very filter it belongs in.

`selected` counts audience entries, not resolved users: the entry (`role:manager`, a bare id) is what the node has, since expansion happens inside the messaging service and is not reported back.
