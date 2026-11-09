---
'@objectstack/skills': patch
---

docs(skills): objectstack-data `security.md` teaches that a package's sharing rule resolves its queue recipient from its own package

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/security.md` now states the rule the sharing plugin enforces since ADR-0150 E4: a declared sharing rule's `sharedWith: { type: 'queue', value }` reads the name as its own package's queue, else the one holder in the package's declared `dependencies` closure plus `sys`, else (no package or environment item declares the name) an organization's `sys_queue` row. Two refusals are taught, each with its refusal code and one example: `outside-closure` (the only holder is a package the rule's package does not depend on, or an environment-authored item) and `ambiguous-in-closure` / `ambiguous-in-environment` (two packages hold the name). A refused rule grants no one new and is warned as `RESOURCE_CONFLICT`; it loads, so nothing earlier tells the author. `evals/hooks-security-seeds-datasources.json` gains case 18, which requires the queue recipient plus a manifest `dependencies` entry on the queue's package and refuses redeclaring the queue in the rule's package. To stay inside the file's token ceiling, restatements whose rule survives elsewhere in the file were cut: the `PermissionSetSchema.rowLevelSecurity` and `definePermissionSet` asides, the "(for `IN`)" table notes, the legacy SQL-predicate bridge sentence, a duplicate recipe link, one recipe comment and one blockquote clause.
