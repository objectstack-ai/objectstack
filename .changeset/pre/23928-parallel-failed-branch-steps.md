---
'@objectstack/service-automation': patch
---

Clause-②: no

A failed `parallel` run now shows what its branches did. Under the block's own `failure` step, the run's step log lists every branch's steps, each tagged with `parentNodeId`, `regionKind: 'parallel-branch'` and its `branch` index: a branch that completed, with its `success` step, and the failing branch's steps up to and including the one that failed, with its error. The run summary counts what those steps did. A fan-out whose notify branch delivered and whose http branch failed now reports `acted: 1` and `failed: 2` (the http step and the block), the way a failed `loop` already does. Before, the log held only the block's failure step and the summary read `acted: 0`. That reads as "nothing happened, safe to re-run" over a notification that had already been sent.

The block now reports its failure once every branch has settled, not at the first branch to fail, so a branch that finishes later keeps its step and its effect is counted. Routing is unchanged. The failure is still the block's returned failure, so a `fault` edge on the `parallel` routes it with the same step code, error text and `$error`. A durable pause refused inside a branch still fails the run.
