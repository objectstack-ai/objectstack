---
'@objectstack/cli': patch
---

fix(cli)!: `docs/nav-target` judges the apps a package body carries on a multi-package artifact

Clause-②: yes (narrowing) — on a multi-package `composeStacks(…, { manifest: 'preserve' })` artifact, a `type: 'doc'` navigation item inside an app a package body carries, whose `doc` or `book` names nothing the artifact carries, built clean before and is now refused by `os build`, `os validate` and `os lint` (`docs/nav-target`).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package's public surface changes: the build-time docs lint now reaches the apps a package body carries, judging them by the rule it already applies to a stack's own apps. A refused nav item is fixed in the app's navigation; there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in the build-time docs lint (`os build`, `os validate`, `os lint`).

- **Before.** The `docs/nav-target` check walked only the artifact's top-level `apps`. A multi-package `preserve` artifact keeps its apps inside the package bodies and has none at its top level, so a nav item in a package's app was never judged: a dead `doc` or `book` target built clean and degraded at runtime.
- **Now.** The check walks the top level's apps when the stack carries the key, otherwise each package body's, the same rule `resolveStackCollection` applies. A package app's `doc` item resolves against every doc the artifact carries, and its `book` item against the declared books and package ids, as a single-package app's always did.
- **Unchanged.** A stack with no `packages[]`, and any stack whose top level carries `apps`, is judged exactly as before.

**The remedy.** For a refused item, name a doc in `src/docs/*.md` or a declared book (a package id is its own implicit book), or remove the item. The refusal message names the nearest match.
