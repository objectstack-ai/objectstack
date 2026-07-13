---
"@objectstack/console": patch
---

Console (objectui) refreshed to `2fb38edbeb12`. Frontend changes in this range:

- fix(app-shell): propagate action-param `visible` predicate through resolveActionParams (#2419)

Completes the create-user phone fix: `resolveActionParams` now carries the
`visible` CEL predicate through to `ActionParamDialog`, so the `phoneNumber`
field is hidden when the `phoneNumber` auth plugin is off
(`features.phoneNumber == false`) instead of rendering a field the backend
rejects.

objectui range: `9138e68413f3...2fb38edbeb12`
