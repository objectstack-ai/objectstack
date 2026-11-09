---
'@objectstack/objectql': minor
'@objectstack/cli': minor
---

feat(objectql)!: inside one namespace, a sharing rule, queue, assignment rule, hook, job, app, page, dashboard, report, book, analytics cube or tool has one package holder — a package declaring one under a name another package of its namespace already holds is refused at install, `os validate` and `os build`, naming every holder.

Clause-②: no (narrowing) — the package door (`SchemaRegistry.installPackage`, every install, boot included) refuses a package registration it accepted before: one whose item of these twelve types bears a name another installed package of the same namespace holds; `os validate` and `os build` refuse the artifact that would carry it. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` does not teach that two packages of one namespace may share one of these names; the rule ships in the refusal text and in ADR-0150 D2 (child N), which already records it.

<!-- adr-0087: not-required (no-migration-prescription) the refusal removes no key, export or field and changes the shape of no stored body; what an author does about a refused name is pick a different one for one of the two items, which no conversion can choose for them -->

**BREAKING** accept-set narrowing at the package registration door, for twelve types: sharing rule, queue, assignment rule, hook, job, app, page, dashboard, report, book, analytics cube and tool — ADR-0150 D2, ruled (record 6724570466), child N of its execution plan. Measured first-party: 0 such names on a booted showcase (29 packages, 60 declared names) and in the four example apps.

- **Why.** ADR-0150 addresses behavioural metadata by namespace and name (a URL segment, the AI face's flat name), and several packages may share one namespace (one artifact's packages, a package and the packages that declare it). The address `crm/home` names one item only if no two packages of `crm` both hold a page `home`. ADR-0130 D3 already refuses that for objects; this extends it to the twelve bucket 2/3 types phase 1's one-holder rule does not cover.
- **Before.** Two packages of one namespace could each ship, say, a page `home`; every bare read served the first-registered one, silently.
- **Now.** The second package's install is refused ahead of every mutation, so it leaves no record behind. The envelope is the namespace gate's: `code: 'NAMESPACE_CONFLICT'`, `status: 422`, every conflicting name in one refusal, every holder named, `conflicts[]` structured. `os validate` and `os build` give the same sentence for an artifact that carries the clash, and `os build` writes no artifact. A deployment whose installed packages of one namespace already share such a name no longer boots: the boot names both holders.
- **Who moves.** An author whose artifact ships two packages of one namespace holding one such name, or whose package declares a name another installed package of its namespace already holds. **The one-line fix: rename the item in one of the two packages.** A reference that named the old name must name the new one; nothing rewrites stored references.
- **Unchanged.** The same name in two different namespaces. The same name across two different types. The same package registering its own item again, or declaring one name twice in itself. A package with no namespace, and the shareable platform namespaces (`base`, `system`, `sys`) the namespace gate lets packages share. An environment item under a package's name (the ADR-0005 overlay). Every type outside the twelve, and phase 1's one-holder rule. `OS_METADATA_COLLISION=warn` does not downgrade the refusal.
