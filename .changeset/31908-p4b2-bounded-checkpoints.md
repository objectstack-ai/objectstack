---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): the audit sealer seals a window into checkpoints of at most 10,000 rows each, and bounds what a pass re-reads while a chain stays skipped

Clause-②: yes (widening)
Metadata-protocol: none

**Bounded checkpoints (ADR-0154 D4, as amended 2026-11-14).** A chain's rows of one window now seal into consecutive checkpoints of at most 10,000 rows each, cut in `(created_at, id)` order, instead of one checkpoint however many rows the window holds. Each checkpoint has its own seed. Its signed body carries two new fields, `part_index` (from 0) and `final_part`, and `sys_audit_checkpoint` stores them in two new nullable columns. A pass that stops in the middle of a window resumes it on the next pass as further `window` checkpoints, never as `late` ones. Late rows split into checkpoints of at most 10,000 rows the same way. The work and memory of one checkpoint no longer grow with the window. A checkpoint written before this release has neither field. It still verifies, reads as one final part, and its chain goes on.

**`os audit verify`.** A row id that two checkpoints list is now a fault of the new kind `listed_twice`, and the run fails. The second listing holds nothing for that row.

**Skipped chains.** While a chain stays skipped by a chain-local fault, it holds back the sealed-through watermark, so each pass walked every window from there and re-read all of them. A pass now walks at most 168 windows that seal nothing (one late horizon) and then stops. When it stops, the sealer says so at `error`, naming the skipped chains. Sealing catches up once the chain fault is fixed.
