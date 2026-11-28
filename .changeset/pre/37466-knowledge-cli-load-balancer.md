---
'@objectstack/cli': patch
---

**Shipped in 19.0.0-next.0**, whose CHANGELOG missed this entry; listed here one prerelease late.

fix(cli): `os knowledge rebuild` and `os knowledge status` give the right answer behind a load balancer

Clause-②: yes (widening)
Metadata-protocol: none

A build's record lives in memory on the node running the build. `os knowledge rebuild` used to exit 1 as soon as a progress read landed on another node, although the build continued and could succeed. It now falls back to the index state the store reports: when a build was due before the rebuild and the adapter keeps a store shared between nodes (not `memory`, whose index is per process), the index turning `current` means the build completed (exit 0, without the counts). It reports failure only on the build's own recorded failure, or after `--timeout` seconds (new flag, default 600) of reads that reached no record of the build, saying the build may still be running. `os knowledge rebuild` now also reads the index state once before it starts the build. `os knowledge status` says when the node that answered holds no build record.
