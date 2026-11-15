---
'@object-ui/app-shell': patch
---

fix(app-shell): a member's record page asks no object definition the metadata door would answer as absent

Clause-②: no
Metadata-protocol: none

A member (a caller with no administrator grant) opening a record page logged two `404`s, `GET /api/v1/meta/object/sys_business_unit` and `GET /api/v1/meta/object/sys_comment_reaction`. The metadata door serves an object's definition only to a caller its read check admits, and answers any other caller as if the object did not exist; the stock member grants hold no read on either object, so both answers are correct, and the page should not have asked.

- The record and list routes ask the definitions of their object's lookup targets, for the cells that link and name them. They no longer ask the target of a field declared `hidden: true`, which no cell draws. That includes the system scope fields the platform adds to an object (`organization_id` and `owning_business_unit_id`), which point at `sys_organization` and `sys_business_unit`; those two reads are gone for every caller.
- The record page asks whether the deployment has `sys_comment_reaction` to choose where reactions are stored. A caller whose loaded grants hold no read on that object is no longer asked: it takes the reactions path the absent answer took before. With no permission provider mounted, the page asks as before.

Nothing a member or an administrator sees on the page changes, and no server answer changes.
