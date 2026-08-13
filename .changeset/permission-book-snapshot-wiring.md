---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

The runtime publish gate's per-write snapshot now carries the sibling collections the three cross-collection security rules compare against (#8309, slice 2 of #7891).

`RuntimeStackContext` gains `permissions` and `books` beside `objects`, the gate's baseline/candidate differential carries all three in both passes (with replace-not-erase semantics for a write into any of them), and `TYPE_TO_STACK_KEY` maps `permission` → `permissions` and `book` → `books` ahead of their `runtimeTypes` registration (#8310). The snapshot construction is exported as `buildRuntimeWriteSnapshots` so tests exercise the real thing instead of a mirror. `@objectstack/metadata-protocol`'s gate call site gathers the two collections from the live registry per publish, the same way it always gathered `objects`.

This repairs the measured defect behind `RUNTIME_NEEDS_FULL_SNAPSHOT`: a per-write snapshot holding exactly one permission set invented 38 phantom `security-master-detail-ungranted` findings where the whole-stack run produces 4 (PR #7886). Per-write and whole-stack verdicts for `security-master-detail-ungranted`, `security-private-no-readscope` and `security-book-audience-unknown-set` now agree. No verdict changes at the door until #8310 declares `permission`/`book` in `runtimeTypes` — the sibling collections cancel in the differential for every currently-gated type.
