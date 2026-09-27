---
'@objectstack/spec': patch
'@objectstack/client': patch
---

`RecordStagePackageBodySchema`, `AssembledInstalledPackageSchema` and `ObjectStackClient.packages.list` now say, in their published docblocks, that `manifest`'s static type is deliberately an index signature and that the runtime schema is the enforced contract (#19324)

Clause-②: no

`AssembledInstalledPackage['manifest']` is `RecordStagePackageBodySchema`, declared `z.ZodType<Record<string, unknown>, Record<string, unknown>>`. So its published type is an index signature: an authoring-stage `InstalledPackage` assigns to `AssembledInstalledPackage`, and a row whose `manifest` belongs to neither stage type-checks as an `InstalledPackageAtEitherStage`. The maintainer ruled that this is the accepted static contract (#19324, letter 丙). The three declarations now say so where a TypeScript reader meets them:

- **The runtime schema is the enforced contract.** `InstalledPackageAtEitherStageSchema.safeParse()` refuses a `manifest` that belongs to neither stage. Tell the two stages apart by parsing, never by the static type.
- **Why the type is not inferred.** `tsc` refuses to print the whole metadata vocabulary into the declarations that embed it (TS7056). Dropping the record and artifact stages' annotations and the `ZodRawShape` cast fails the declaration build with TS7056 at `PackageApiContracts`. A named alias would turn `stack.zod` into a shared declaration chunk, the heap failure #14513 recorded.
- **The precise form, if the schema depth ever allows it,** is the one #19324 measured as A2, with its cost recorded at `RecordStagePackageBodySchema`.

**`@objectstack/client`**: the `packages.list` TSDoc used to call this asymmetry "a KNOWN GAP rather than a design", tracked on #19324, and cited a `stack.zod.ts` line number. It now calls it the accepted static contract, cites `RecordStagePackageBodySchema` by name, and keeps its advice unchanged: narrow a row by parsing it with a `@objectstack/spec` schema, and never by `Array.isArray(pkg.manifest.objects)`.

This settles what the `@objectstack/client` read-door changeset (#17536) calls "a known gap, tracked as #19324". The gap is not closing under #19324: it is the accepted static contract, and the client pin that records it stays.

⛔ No behaviour changes. No type, schema, accept set, authorable key or export moves. Only TSDoc and source comments change, and they ship:

- `@objectstack/spec`'s published `files[]` carries `dist`, where the TSDoc is emitted into the `.d.ts` / `.d.mts` declarations, and `src/**/*.zod.ts`, so both edited files also ship as source.
- `@objectstack/client`'s published `files[]` carries `dist`, where the rewritten paragraph lands in `index.d.ts`, `index.d.mts`, `index.js` and `index.mjs`.
