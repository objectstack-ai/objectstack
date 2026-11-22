---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a record-share hit in the ⌘K palette and global search is titled by the recipient, not by the raw recipient id

Clause-②: no
Metadata-protocol: none

`sys_record_share` is titled by `recipient_id`, a text column holding a principal id whose kind `recipient_type` names. Search followed only a reference-typed title pointer to its target's title, so every record-share hit read as a bare user id.

`searchAll` now reads the declaration the console's recipient face reads, a text title pointer with `widget: 'recipient-picker'` and `dependsOn: ['recipient_type']`, and titles the hit by the directory record its kind names: a `user` recipient by its `sys_user` title, a `team` by `sys_team`, a `business_unit` or `unit_and_subordinates` recipient by its `sys_business_unit` title. Each directory is read once per swept object, as the searcher, under the same gates as a reference title: a reader refused the directory object, the row or its title column keeps the bare id, and a directory read that fails fails the search. A `group` or `position` recipient keeps its stored value, as it does in the console. The hit's wire shape is unchanged: `record` still carries the stored id.
