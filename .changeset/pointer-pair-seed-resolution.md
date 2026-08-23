---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
"@objectstack/plugin-audit": minor
---

Seeds can now address an ActivityPointer (#11339, ADR-0052 §5): a `text` field may declare `referenceVia: '<sibling>'`, marking it as the id half of a polymorphic pointer pair whose target object the sibling column names per row (`sys_activity.record_id` via `object_name`, `source_id` via `source_object` — both now declared). The seed loader resolves such pointers as natural keys against the object each row names — the same externalId probes, in-memory map and pass-2 deferral static lookup references use — so a packaged app's seed can ship timeline rows that actually attach to their records, and the shipped console filter `{ object_name, record_id }` matches them.

The accept/reject contract changes with it, deliberately: an unresolvable pointer on a DECLARED pair is now a loud, counted failure (`success: false`, `error`-level log, record dropped when no pass 2 can heal it) instead of the old silent verbatim store — a row that rendered on no timeline and matched no filter. Undeclared text columns are untouched: only `referenceVia` opts a pair in. Authoring contradictions are refused at parse time (`referenceVia` is text-only and mutually exclusive with `reference`) and at `ObjectSchema.create` (the sibling must be a declared field). Internal-id-shaped values still pass through verbatim, so seeds wiring real ids keep working.
