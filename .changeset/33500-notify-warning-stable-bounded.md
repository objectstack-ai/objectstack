---
'@objectstack/service-automation': patch
---

fix(service-automation): a `notify` step warning carries no count, and each warning text on a run summary row is bounded

Clause-②: no
Metadata-protocol: none

**The `notify` warning text is stable per cause.** A `notify` step whose deliveries failed put the per-execution count in its warning (`every delivery it attempted failed (3)`, `channel 'push' (2 deliveries): …`, `2 of 5 deliveries failed`). A `notify` in a loop whose recipient count varied raised a different text on each iteration for one refused channel, so the run summary row's distinct-text fold folded nothing and its five-entry list filled with near-duplicates. The text now names the failed channels, each failure's own reason, and whether anything got through (`notify delivered nothing: every delivery it attempted failed. channel 'push': …` or `notify: some deliveries failed while others were delivered or enqueued. channel 'push': …`), and no count. The counts stay where they were: the node's output (`failed`, `delivered`, `enqueued`) per execution. A reader that parsed the count out of the warning text reads it from the node output instead.

**Each warning text on a run summary row is bounded.** `summary.nodes[].warnings` keeps at most five distinct texts plus one overflow entry; each text is now also cut at 300 characters, ending with ` [... cut; the step log holds the full text]`. Two long texts that agree up to the cut fold into one entry. The run's step log keeps every text whole. Before, a few nodes with long warning texts could push a run's persisted summary past its byte cap, whose fallback drops the whole node list.
