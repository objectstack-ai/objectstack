---
'@objectstack/rest': patch
---

fix(rest): the one-request record page accepts a related list keyed by a `user` field again

Clause-②: no
Metadata-protocol: none

- **Regression in 18.3.0 (#29946, duly#185).** `POST /data/:object/:id/page` (#27713) checked each related list's field against a private `lookup`/`master_detail` list and read `reference` raw, so a related list on `sys_user` keyed by a `user` field (an owner, an assignee) answered `400 VALIDATION_FAILED … is not a lookup or master-detail field that references 'sys_user'`, and the console's full-page record view showed "could not load this record". The related list's own row query (`{ [field]: id }`) follows that field, and 18.2.0 read each related list through that list read, with no type check.
- The check now asks the spec's one arbiter of a field's target, `referenceTargetOf` (`lookup`, `master_detail`, `user`, `tree`; a `user` field's target is fixed to `sys_user` by its type, whether or not its `reference` spells it), the same judgement the engine's `$expand` and delete walk read. A field that does not reference the page's object is still a located `400 invalid_relationship`: a `user` field on any other object's page, a `lookup` to another object, a `tree` on another object, an unreadable `reference` carrier. The message now reads `… is not a lookup, master-detail, user or tree field that references '<object>'.`
