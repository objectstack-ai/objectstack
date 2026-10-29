---
'@objectstack/cli': minor
---

fix(cli)!: `docs/nav-target` judges the navigation each package body contributes on a multi-package artifact

Clause-②: no (narrowing) — on a multi-package `composeStacks(…, { manifest: 'preserve' })` artifact, a `type: 'doc'` item in a package body's `navigationContributions`, whose `doc` or `book` names nothing the artifact carries, built clean before and is now refused by `os build`, `os validate` and `os lint` (`docs/nav-target`).
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package's public surface changes: the build-time docs lint now reaches the navigation contributions a package body carries, judging them by the rule it already applies to a single-package stack's contributions. A refused item is fixed in the contribution; there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in the build-time docs lint (`os build`, `os validate`, `os lint`).

- **Before.** The `docs/nav-target` check read `navigationContributions` off the artifact's top-level manifest only. On a multi-package `preserve` artifact that manifest is the owner package's copy, so a contribution from any other package was never judged: a dead `doc` or `book` target built clean and degraded at runtime.
- **Now.** When the stack carries `packages[]`, the check reads each package body's `navigationContributions` (the owner's included, judged once); otherwise the top-level manifest's. A contributed `doc` item resolves against every doc the artifact carries, and a `book` item against the declared books and package ids, as a single-package contribution always did.
- **Unchanged.** A stack with no `packages[]` is judged exactly as before.

**The remedy.** For a refused item, name a doc in `src/docs/*.md` or a declared book (a package id is its own implicit book), or remove the item from the contribution. The refusal message names the nearest match.
