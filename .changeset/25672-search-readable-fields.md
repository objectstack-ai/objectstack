---
'@objectstack/objectql': patch
---

fix(objectql): a free-text `search` resolves only over the fields the caller may query

Clause-②: yes (widening)
Metadata-protocol: none

The server-resolved search set used to include fields the caller cannot read, so the field-read predicate guard refused the whole expanded `$or` with 403. On `sys_user`, `role`, `ban_reason` and `last_login_ip` broke every user and owner picker for non-admin members as soon as they typed. The engine now asks the registered security service's `getQueryableFields` (the complement of what the guard refuses) and withholds every other field from the resolved set, on `find`, `findOne`, `count` and `aggregate`. The guard is unchanged: an explicit `filter`, or a `searchFields` naming a hidden field, is still refused with 403. A search whose declared fields are all hidden from the caller answers the existing `400 INVALID_FIELD` empty-search-set refusal, never every row.
