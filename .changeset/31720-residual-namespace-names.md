---
'@objectstack/objectql': minor
---

feat(objectql)!: a `packages[]` stack's own top-level items (the residual no package body declares) are judged by the namespace name rule too — a residual sharing rule, queue, assignment rule, hook, app, page, dashboard, report, book, analytics cube or tool under a name another package of the stack's namespace holds is refused, naming every holder.

Clause-②: no (narrowing) — the `manifest` service (every artifact or config registration, boot included) refuses a stack it accepted before: one whose residual top-level item of these types bears a name an installed package of the stack's `manifest.namespace` holds; and the package door refuses a package it accepted before: one holding such a name that a registered stack's residual of its namespace already holds. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` does not teach that a stack's top level may repeat a name another package of its namespace holds; the rule ships in the refusal text and in ADR-0150 D2.

<!-- adr-0087: not-required (no-migration-prescription) the refusal removes no key, export or field and changes the shape of no stored body; what an author does about a refused name is pick a different one for one of the two items, which no conversion can choose for them -->

**BREAKING** accept-set narrowing at the `manifest` service, for one more holder of ADR-0150 D2's namespace name rule (#31717): the residual of a `packages[]` stack, registered under the stack's own id after every body and never through the package door. Measured first-party: 0 stacks carry a residual item of these types (the one first-party `packages[]` stack, `examples/app-multi-package`, has no residual at all).

- **Why.** ADR-0150 addresses these items by namespace and name. #31717 refuses a package holding a name another package of its namespace holds; the residual registers without an install, so it was not judged, and a residual `crm/home` beside a co-owner's `crm/home` made the address name two items.
- **Before.** The residual item registered under the stack's id beside the other package's item, silently.
- **Now.** Once every body of the stack has installed and before anything of the residual registers, the residual is judged as one holder of the stack's namespace, with the package door's predicate and sentence: `code: 'NAMESPACE_CONFLICT'`, `status: 422`, every holder named, `conflicts[]` structured. A refusal puts the whole artifact back, as any refusal in that run does. A registered residual is then a holder of its namespace for what registers after it, so a package arriving later with the residual's name is refused at the package door, naming the stack's id: the order the two arrive in does not decide. A deployment that already holds such a pair no longer boots: the boot names both holders.
- **Who moves.** An author whose stack's top level carries an item of these types that no body declares, under a name an installed package of the stack's namespace already holds. **The one-line fix: rename one of the two items** (or declare it in one of the stack's packages, so it is that package's).
- **Unchanged.** A residual in a namespace no other package holds the name in; another namespace; the shareable platform namespaces (`base`, `system`, `sys`); every type outside these; a residual owned by one of the stack's own bodies (one holder); `os validate` / `os build`, which cannot see installed packages and where a residual can never share a covered name with the stack's own bodies (a body holding the name claims it, so it is not residual); the package door and phase 1's bare-name rule.
