---
"@objectstack/spec": patch
---

docs(spec): `implement-objectos.md` Rule #3 names real exports instead of `RequestEnvelope` / `ResponseEnvelope` (#9614)

The published runtime-kernel prompt told an implementing agent to "validate
`RequestEnvelope`" and "wrap in `ResponseEnvelope`". Neither has ever been an
export of `@objectstack/spec` — measured across all 16 published
`api-surface/*.json` entries — and `ResponseEnvelopeConfig*` is a config shape,
not the envelope, so it was not a drop-in referent.

Rule #3 now describes the validation surface the package actually has:

- **Requests**: there is no single request envelope by design.
  `StandardApiContracts` maps each standard operation to its `input`
  (`CreateRequestSchema`, `UpdateRequestSchema`, `IdRequestSchema`,
  `BulkRequestSchema`, and `QuerySchema` for `list`), and `ApiEndpointSchema`
  carries the route's own shape — which is what makes `api/endpoint.zod.ts`, a
  file the rule already cited, actually reachable from it.
- **Responses**: `BaseResponseSchema` is the envelope skeleton that each
  response type extends with its own `data`, and the rule now carries the
  warning the schema's own docstring makes: `safeParse` alone does not prove
  conformance, because the schema strips unknown keys and accepts a payloadless
  `{ success: true }`. `envelopeViolations(body)` is the conformance check.

The referents also move from prose into a fenced `import`, so
`check:published-readme-exports` resolves them from now on — the blind spot that
let the two fabricated names ship (prose symbols match neither an import clause
nor a member call site) no longer covers this rule.

No schema, no runtime behaviour and no authorable surface changes; the published
prompt text does.
