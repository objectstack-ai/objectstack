---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

fix(spec): the permission-set form's Name help says when the name is filled from the label, and when to type it

Clause-②: no
Metadata-protocol: none

The Console's create form fills a new permission set's Name from the Label's Latin letters and digits only, so a label written all in Chinese or Japanese fills nothing. The Name help used to say the name is derived from the label in every case, so a zh-CN or ja-JP administrator saw an empty, required Name under a hint that said it had been filled. The help now names both outcomes: filled from the label's Latin letters and digits, otherwise typed by the administrator, in snake_case. The zh-CN, ja-JP and es-ES translations follow. No schema, accepted value or create behaviour changes.
