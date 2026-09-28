---
'@objectstack/spec': minor
---

fix(spec): `ApiError.code` and a flattened list overlay's legacy `options` bag carry the shapes their doors accept (#19920)

Clause-②: no (narrowing)

**BREAKING for TypeScript code that annotates with `ApiError`, with any response type built on `BaseResponseSchema` (`BaseResponse`, `BatchUpdateResponse`, `SessionResponse`, the metadata, package, storage, analytics and automation response types, and the rest), with `ViewMetadata`, `ViewMetadataParsed`, `AssembledViewArtifact` or `AssembledViewArtifactParsed`, or with the input type of a schema returned by `makeApiErrorSchema`**: a narrowing of published TYPES, landing in the launch window as `minor` (the lockstep convention: the bump level is not the carrier, this banner and the disposition below are). The runtime accept set does not move at all: no schema's parse, no value and no export changes, and no export is added.

Two places in the published types were wider than the doors that judge the same bodies, so values those doors refuse type-checked:

- `ApiError.code` (the INPUT type of `ApiErrorSchema`): FROM `unknown` TO `ErrorCode`, the vocabulary the schema parses against (`StandardErrorCode` and the registered ledger codes). `ErrorCode` was cast to `z.ZodType` with its output type only, and `z.ZodType`'s input type defaults to `unknown`, so `{ code: 42, message: 'x' }` compiled as an `ApiError` while the schema refuses it at `code`. The same `code` narrows in the `error` of every response envelope built on `BaseResponseSchema`, and in each `ApiError` row of a batch result. `makeApiErrorSchema(codes)` had the same cast for a caller-supplied vocabulary: its schema's input `code` is now the standard catalogue plus `codes`, where it was `unknown`. The parsed types (`ApiErrorParsed`, the `…Parsed` response types) do not move: their `code` was already typed.
- A flattened list overlay's legacy `options` bag: FROM a string-keyed record of `unknown` TO one optional entry per list kind that has a block (`calendar`, `chart`, `gallery`, `gantt`, `kanban`, `map`, `timeline`, `tree`), each entry that kind's own block with every key optional. This holds on the list overlay member of `ViewMetadata`, `ViewMetadataParsed`, `AssembledViewArtifact` and `AssembledViewArtifactParsed`. `options: { foo: 1, kanban: 42 }` type-checked as all four while that member refuses both keys.

**If your code stops compiling.** A value you annotated with one of these names is not the shape the door accepts: correct it, or type a value that is still unvalidated as `unknown` and let the schema's `safeParse` decide. An error `code` is a member of `ErrorCode` (or, for a `makeApiErrorSchema` schema, of the standard catalogue plus the codes you supplied); a producer whose own code is outside the vocabulary reports it on `declaredCode`, not `code`. An `options` bag carries only the per-kind blocks listed above, each judged key by key like the top-level block of the same kind; `grid` has no block, and its settings are top-level keys of the view.

The declared types of `ErrorCode` and of `makeApiErrorSchema`'s `code` narrow with them, so `z.input` of each is typed where it was `unknown`. The types are the schemas' declared shapes, not their verdicts: refinements are not types, so each schema remains the only judge.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes moves — no spec key, no export and no stored row changes, and every runtime accept set is unchanged, so `objectstack migrate meta` has nothing to reach — and only TypeScript annotations narrow, whose channel is the consumer's compiler. -->
