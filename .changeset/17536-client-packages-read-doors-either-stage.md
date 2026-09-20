---
"@objectstack/client": minor
---

fix(client): the four `packages` READ members declare the stage their door is declared at (#17536)

Clause-②: yes

**BREAKING** for TypeScript consumers — a published TYPE-surface WIDENING, shipped as `minor` under the launch-window convention (`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by this banner and the ADR-0087 disposition below, never by the level). No runtime behaviour changes, and none is possible here: only a declaration moved, and the values these four methods resolve to are the values they have always resolved to.

`ObjectStackClient.packages.list` / `.get` and their `ScopedEnvironmentClient` twins returned `InstalledPackage` — the AUTHORING manifest stage, imported from `@objectstack/spec/kernel`. Since PR #17517 both read doors have been declared at EITHER stage: `ListInstalledPackagesResponseSchema.packages` is `z.array(InstalledPackageAtEitherStageSchema)` and `GetInstalledPackageResponseSchema.data` is that same schema. ⇒ A response the server is declared able to send was one this SDK's own types said could not arrive.

`packages/spec` is the one contract between producers and consumers, and `packages/client` is a consumer of it, so the consumer's declaration is what moves. All four now declare `InstalledPackageAtEitherStage` from `@objectstack/spec/api`.

**What the union is, and what it is not.** It is a union of two whole, closed stages — `InstalledPackageSchema` and `AssembledInstalledPackageSchema` — that differ in exactly one key, `manifest`. Every other member of the row (`id`, `name`, `version`, `status`, `enabled`, `installedAt`, …) is common to both branches and reads exactly as it did. A row belonging to neither stage is refused by both branches and therefore by the declaration; ⛔ this is not a tolerant shape and must never be relaxed into one.

**What a consumer does.** Code that reads only the common members needs no change at all. Code that reaches INTO `manifest` separates the two stages first, because the authoring stage's `objects` are GLOB STRINGS while the assembled stage's are object DEFINITIONS — the compiler now says so at the call site instead of letting a glob-shaped read compile against a row that carries definitions. In this repository the whole consumer cost is zero sites outside `packages/client` itself: no other workspace package calls either read member.

**The three WRITE members did not move** and stay declared at the authoring stage. `install` / `enable` / `disable` answer the row their own request contract produced — `PackageInstallRequestSchema` declares `manifest: ManifestSchema` — and PR #17517 moved the read doors alone. That asymmetry is the measurement, not an oversight, and it is pinned.

The type is reached the same way `InstalledPackage` always was, from `@objectstack/spec` rather than re-exported here: this SDK has never re-exported the package row, and this change does not start.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves. No metadata key, no authored property, no config field, no accepted request shape and no stored artifact changes spelling or shape: the edit is four declared RETURN TYPES on one SDK class pair plus their docblocks, so `objectstack migrate meta` has nothing to rewrite, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. The party addressed is a TYPESCRIPT CONSUMER and the delivery channel is the compiler at their own call site — the audience the ADR-0087 ledger explicitly does not serve. The "what a consumer does" paragraph above is a source-code statement about narrowing a union, not a stored-metadata rewrite, which is the distinction #13080 records this refusal cannot make on its own.
     `type-surface-only` is NOT claimed here, and it is unavailable on the merits rather than on a resolution defect — measured by driving the gate, not assumed. That category was added for a published TYPE-surface NARROWING, and its predicate 4 (`narrowed-from-erased`) reads the base annotation through `isErasedType`, whose line is "the type IS `any` / `unknown`". At the merge base all four members carried a CONCRETE annotation (`Promise<InstalledPackage>`, `Promise<{ packages: InstalledPackage[]; total: number }>`), so nothing moved off an erased type; and this change runs in the opposite direction from the one the category names. The **BREAKING** banner is carried rather than dropped — that erosion is exactly what #13080 was filed about. -->
