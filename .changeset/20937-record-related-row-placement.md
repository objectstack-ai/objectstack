---
'@objectstack/spec': patch
---

docs(spec): the `record_related` action location's docblock names its placement, each row of a related list inside a parent record, instead of "a related list section" (#20937)

Clause-②: no

Only the `record_related` line of the `ACTION_LOCATIONS` docblock in `src/ui/action.zod.ts` changes. It now states the contract a renderer implements: a per-row action on each row of a related list shown inside a parent record, in that parent's context only. Unlike `list_item`, which surfaces on every row wherever the object is listed, it never surfaces on the object's own list views. The old words, "actions on a related list section", could be read as the section's toolbar. `ACTION_LOCATIONS` and `ActionLocationSchema` are unchanged: the same six values parse, and no `.describe()` string, export or runtime behaviour moves. The console's placement of `record_related` actions on related-list rows ships separately.
