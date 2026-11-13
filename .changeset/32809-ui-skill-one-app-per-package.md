---
'@objectstack/skills': patch
---

docs(skills): the objectstack-ui skill states the one-app-per-package rule for app and module packages alike

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ui/SKILL.md` § App Navigation said `defineStack` refuses a second app "in a `type: 'app'` package", which let an author conclude that a `type: 'module'` package may carry several apps. `defineStack` refuses a second app in a module package too (`STACK_SINGLE_APP_VIOLATION`, ADR-0019 (app-as-consumer-unit) D3 as amended), so the paragraph now names both package types and the remedy: each further app goes in a module of its own with the objects it shows. Growth is paid in the same file by deleting the restated tail of Common Pitfalls 2; the file's token count is unchanged at its ceiling.
