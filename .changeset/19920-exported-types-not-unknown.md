---
'@objectstack/spec': patch
---

fix(spec): `InlineAction`, `ViewMetadataParsed`, `AssembledViewArtifact` and `AssembledViewArtifactParsed` name the shapes their TSDoc promises instead of being `unknown` (#19920)

Clause-②: no

Types only. No schema, no parse and no export moves: every runtime accept set is unchanged, and so is the declared type of every schema. Four published type aliases were derived from a schema whose own static type erases to `unknown`, so any value type-checked against them. Each is now derived from the member schema the parse actually runs:

- `InlineAction`: FROM `z.input<typeof InlineActionSchema>` (`unknown`, because the schema is a `z.preprocess` whose input is the preprocess function's `unknown` parameter) TO `z.input<(typeof InlineActionSchema)['out']>`, the input type of the picked action object.
- `ViewMetadataParsed`: FROM `z.infer<typeof ViewMetadataSchema>` (`unknown`, because the union's members are cast to `z.ZodTypeAny` where it is built) TO the union of the OUTPUT types of `VIEW_METADATA_MEMBERS`, the same record `ViewMetadata` reads its input types from. `diagnoseViewMetadata` keeps returning the schema's own parse output as `data`; only that value's static type changes.
- `AssembledViewArtifact` / `AssembledViewArtifactParsed`: FROM `z.input` / `z.infer` of `AssembledViewArtifactSchema` (`unknown`, the same cast) TO the input / output union of the three non-container `VIEW_METADATA_MEMBERS`, the members that schema's union is mapped from. A container body is now a compile error here, as it always was at the schema.

**If your code stops compiling.** A value you annotated with one of these names is not the shape the name describes: correct it, or type a value that is still unvalidated as `unknown` and let the schema's `safeParse` decide. For `InlineAction`, the legacy `type: 'navigation'` and `to` spellings are refused by the type while `InlineActionSchema` still folds them onto `url` / `target`: write `type: 'url'` and `target`.

The types are the members' declared shapes, not the schemas' verdicts. Each schema still accepts some bodies its type refuses (the preprocess folds and strips) and still refuses some bodies its type admits (refinements are not types), so the schema remains the only judge.

`JoinedReportBlock` is not changed by this release. It is still `unknown`.
