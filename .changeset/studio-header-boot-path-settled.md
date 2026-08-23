---
"@objectstack/studio": patch
---

Corrected the package header's transitional NOTE, which had drifted stale in
two opposite directions.

Verified directly against the boot path at head, not against the header's
own narrative: `plugin-dev`'s `DevPlugin` boot loop and `cli`'s `os serve`
app-package loop both deliberately register only `@objectstack/setup` and
`@objectstack/account` — Studio's exclusion is a settled decision, not a
pending follow-up, because the console ships its own dedicated Studio
surface. `plugin-auth`'s manifest has likewise already stopped registering
Studio (ADR-0048); that removal is done, not "landing separately" as the
stale header implied.

The header's other transitional claim is still accurate and was left
unchanged: `STUDIO_APP` is still imported from
`@objectstack/platform-objects/apps` rather than defined in this package.

Comment-only: no export, behaviour, or boot path changed.
