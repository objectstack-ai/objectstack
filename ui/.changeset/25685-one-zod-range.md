---
"@object-ui/app-shell": patch
"@object-ui/components": patch
"@object-ui/plugin-timeline": patch
"@object-ui/types": patch
---

Clause-②: no
Metadata-protocol: none

One zod range: `@object-ui/app-shell`, `@object-ui/components`, `@object-ui/types` and `@object-ui/plugin-timeline` declare `zod` as `^4.6.5`, the range the objectstack monorepo declares, so the merged lockfile resolves one zod rather than two. The console bundle already carried a single copy; what changes is the declared floor.
