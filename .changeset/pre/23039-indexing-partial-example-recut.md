---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-data` indexing rule's partial-index example teaches the rule with an application-shaped index instead of restating the platform's overlay uniqueness key (#23039)

Clause-②: no

`skills/objectstack-data/rules/indexing.md`'s "Access methods and partial indexes" section illustrated a partial index with the platform's own overlay-uniqueness DDL and said that was what `ensureOverlayIndex` runs. The quoted key had four parts; the platform's runtime key has carried a fifth, `bundle_member`, since protocol 18, so the sentence stated something the platform no longer runs. The example is re-cut to an application-shaped partial index — one *active* subscription per account, the coarse `{ fields: ['account_id'] }` declared in metadata and the unique partial form built in a migration — so the rule is taught without restating a platform key that changes on its own schedule. The rule itself is unchanged: declare the coarse index (or none) in metadata, build the partial form as raw SQL in a runtime migration, fall back to a plain index on a dialect that rejects the predicate. Nothing an author writes changes.
