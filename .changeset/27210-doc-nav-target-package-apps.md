---
'@objectstack/cli': patch
---

fix(cli): `docs/nav-target` judges the apps a package body carries on a multi-package artifact

Clause-②: no
Metadata-protocol: none

`os build`, `os validate` and `os lint` check that a `type: 'doc'` navigation item opens a doc or book the artifact carries. The check walked only the artifact's top-level `apps`. A multi-package `composeStacks(…, { manifest: 'preserve' })` artifact keeps its apps inside the package bodies and has none at its top level, so a nav item in a package's app was never judged: a dead `doc` or `book` target built clean and degraded at runtime.

The check now walks the top level's apps when the stack carries the key, otherwise each package body's, the same rule `resolveStackCollection` applies. A single-package stack is unchanged. A multi-package artifact whose package app names a doc or book it does not carry now gets the `docs/nav-target` error a single-package app already got, with the same remedy in its message.
