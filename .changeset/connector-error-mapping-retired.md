---
"@objectstack/spec": minor
---

feat(spec): retire `connector.errorMapping` — eleven authorable keys nothing ever read, one of them spelled like the live `userMessage` channel (#14676, ADR-0049)

<!-- adr-0087: registered connector-error-mapping-removed -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).
Triage ruling 2026-09-02 on the census card: ADR-0049 enforce-or-remove decides
it — declared-but-unenforced authorable surface with zero measured pull for a
reader comes off.

`ConnectorSchema.errorMapping` carried `ErrorMappingConfig` (`rules`,
`defaultCategory`, `unmappedBehavior`, `logUnmapped`) and its
`ErrorMappingRule[]` (`sourceCode`, `sourceMessage`, `targetCode`,
`targetCategory`, `severity`, `retryable`, `userMessage`) — eleven keys on the
published authorable surface that **nothing read**: measured on `origin/main`,
the only reference outside the declaring file and its unit test was a
type-identity pin. No provider, dispatcher or materializer ever mapped an
external error through the rules, so `unmappedBehavior` configured nothing and
a rule's `userMessage` was never shown to anyone. That spelling is what made
this worse than ordinary dead surface: it is the name of the **live**
API-error channel (`ApiError.userMessage`, the user-facing refusal text a
thrown HTTP error declares), so an author who had read that documentation and
wrote a connector rule reasonably believed they were marking a refusal for an
end user — and the failure was silent in both directions (it validated, it
published, no message was ever shown). Removal resolves the collision by
deletion; the live channel is untouched.

**What is refused:** authoring `errorMapping` on a connector, with any value.
`ConnectorSchema` is a non-strict `z.object`, so the key is a `retiredKey()`
tombstone rather than a bare deletion (a deletion would have stripped it in
silence): authoring it is a `tsc` error (`never`) and a parse error carrying
the prescription, on the base schema and — through
`DeclarativeConnectorEntrySchema`, which `superRefine`s the same shape — on
`stack.connectors[]` and the `PUT /api/v1/meta/connector/:name` door.

**What leaves the public surface:** `ErrorMappingConfigSchema` /
`ErrorMappingConfig` / `ErrorMappingConfigParsed`, `ErrorMappingRuleSchema` /
`ErrorMappingRule`, and `ConnectorErrorCategorySchema` / `ConnectorErrorCategory`
(the enum's only consumers were the two removed shapes; an exported value
schema with no consumer reads as a capability). `api/ErrorCategory` — the
HTTP-response vocabulary — is unaffected.

**What stays, byte-identical:** every other connector key (`health`, `retry`,
`webhooks`, `fieldMappings`, `syncConfig`, `actions`, `triggers`, `provider`,
`providerConfig`, `auth`, …) with its default and its readers.

## FROM → TO

```ts
// before — parsed green; nothing ever read the block, no message was ever shown
defineStack({
  connectors: [{
    name: 'payments_api',
    label: 'Payments API',
    type: 'api',
    errorMapping: {
      rules: [{
        sourceCode: 429,
        targetCode: 'RATE_LIMITED',
        targetCategory: 'rate_limit',
        severity: 'medium',
        retryable: true,
        userMessage: 'The payment provider is busy; try again shortly.',
      }],
      unmappedBehavior: 'generic_error',
    },
  }],
});

// after — delete the key; there is no replacement because no error-mapping
// engine exists: a connector's failures reach callers as the provider's own
// errors (ADR-0097). A user-facing refusal text is the API error envelope's
// `userMessage`, declared by the code that throws — not connector metadata.
defineStack({
  connectors: [{ name: 'payments_api', label: 'Payments API', type: 'api' }],
});
```

One-line fix: delete the `errorMapping` block; `os migrate meta --from 17`
lists the mechanical edits for existing sources.

The retirement kit:

- `retiredKey()` tombstone on `ConnectorSchema.errorMapping`
  (`packages/spec/src/integration/connector.zod.ts`; the section comment
  records what the shape was), inherited by `DeclarativeConnectorEntrySchema`
- ADR-0087 registration: `integration/Connector:errorMapping` and
  `integration/DeclarativeConnectorEntry:errorMapping` in
  `RETIRED_KEYS_BY_MAJOR[18]`; `integration/ErrorMappingConfig`,
  `integration/ErrorMappingRule`, `integration/ConnectorErrorCategory` in
  `RETIRED_DEFS_BY_MAJOR[18]`; the D2 conversion
  `connector-error-mapping-removed` (protocol 18) wired into the step-18 chain
  — a pure lossless strip of the block from every `connectors[]` entry, one
  notice per connector (the eleven nested keys leave with the block)
- no liveness-ledger row: `connector` is not an enrolled ledger type, so
  there is no row to keep or drop
- pin tests (`connector.test.ts`): refusal pins asserting the issue path,
  code and prescription on the base schema, the declarative entry, and the
  `stack.connectors[]` authoring path; the tsc `never` channel; a
  no-materialize pin; the conversion's strip and notice; zero holders of the
  seven retired names on every public entry; the ADR-0087 registration
- generated baselines/docs follow the schema (`authorable-surface/`,
  `authorable-defaults/`, `api-surface/`, `json-schema.manifest/`,
  `declaration-map/`, `export-origins/`, spec-changes, upgrade guide,
  reference docs)
- zero authored occurrences in this repo's examples, skills and docs, and
  zero hits in objectui at `0d8fd7c`, so no in-repo source changes ride along
