---
'@objectstack/spec': minor
---

fix(spec): `JoinedReportBlock`, a ViewItem's `config` and a flattened overlay's `viewKind` carry the shapes their doors accept (#19920)

Clause-②: yes (narrowing)

**BREAKING for TypeScript code that annotates with `JoinedReportBlock`, `Report`, `ReportParsed`, `ViewItem`, `ViewItemWire`, `ViewMetadata`, `ViewMetadataParsed`, `AssembledViewArtifact` or `AssembledViewArtifactParsed`, or that passes an unchecked value to `defineReport` / `defineViewItem`**: a narrowing of published TYPES, landing in the launch window as `minor` (the lockstep convention: the bump level is not the carrier, this banner and the disposition below are). The runtime accept set does not move at all: no schema's parse, no value and no existing export changes. Three parsed-state type names are added (below); nothing is removed or renamed.

Three places in the published types were wider than the doors that judge the same bodies, so values those doors refuse type-checked:

- `JoinedReportBlock`: FROM `unknown` TO the input shape of `JoinedReportBlockSchema`. The schema was annotated `z.ZodTypeAny`, which erased its shape; it now carries its inferred type. The same erasure made every `blocks[]` element of `Report` / `ReportParsed` (and so of `defineReport`'s parameter) `unknown`; each is now a block.
- A ViewItem's `config`: FROM `unknown` TO the arm's own config type, a `ListView` config on the `list` arm and a `FormView` config on the `form` arm. This holds on `ViewItem`, `ViewItemWire`, `defineViewItem`'s parameter and return, and the `viewItem` member of `ViewMetadata`, `ViewMetadataParsed`, `AssembledViewArtifact` and `AssembledViewArtifactParsed`. The arm builder took `config` as `z.ZodTypeAny`; it is now a generic parameter.
- A flattened overlay member's `viewKind`: FROM `'list' | 'form'` on both members TO `'list'` on the list overlay and `'form'` on the form overlay, the one value each member accepts. A list-shaped body naming `viewKind: 'form'` used to type-check, through the list overlay member, as `ViewMetadata`, `ViewMetadataParsed`, `AssembledViewArtifact` and `AssembledViewArtifactParsed`.

**If your code stops compiling.** A value you annotated with one of these names, or passed to `defineReport` / `defineViewItem`, is not the shape the door accepts: correct it, or type a value that is still unvalidated as `unknown` and let the schema's `safeParse` decide. A ViewItem's `config` must match its `viewKind`: a `ListView` config under `viewKind: 'list'`, a `FormView` config under `viewKind: 'form'`.

The declared types of `JoinedReportBlockSchema`, `ViewItemSchema` and `ViewItemWireSchema` narrow with them, so `z.input` / `z.infer` of each is typed where it was `unknown` (or carried an `unknown` `config`). Typed, each schema's input and output now differ by its defaults, so three ADR-0122 parsed-state aliases are added beside the bare names: `JoinedReportBlockParsed`, `ViewItemParsed` and `ViewItemWireParsed`. Nothing is removed or renamed.

One default is applied by the parse and is absent from `ViewMetadataParsed` / `AssembledViewArtifactParsed`, and their TSDoc now says so: the flattened list overlay member re-applies `type: 'grid'` in an `.overwrite()`, so every body it parses carries `type`, while its output type leaves `type` optional.

The types are the members' declared shapes, not the schemas' verdicts: refinements are not types, so each schema remains the only judge.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes moves — no spec key, no existing export and no stored row changes (three parsed-state type names are added, none removed or renamed) and every runtime accept set is unchanged, so `objectstack migrate meta` has nothing to reach — and only TypeScript annotations narrow, whose channel is the consumer's compiler. -->
