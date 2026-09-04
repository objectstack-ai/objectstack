// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14676 — ADR-0049 enforce-or-remove on `ConnectorSchema.errorMapping` (triage
// ruling 2026-09-02: removal via the `spec-property-retirement` playbook; the
// split condition — a downstream consumer in objectui or a customer stack —
// measured empty at objectui `0d8fd7c`, hotcrm not measurable). The key carried
// `ErrorMappingConfig` (4 keys) and its `ErrorMappingRule[]` (7 keys), and
// NOTHING read them: outside the declaring file and its unit test the only
// reference in the tree was a type-identity pin. No provider, dispatcher or
// materializer ever mapped an external error through the rules, so
// `unmappedBehavior` configured nothing and a rule's `userMessage` was never
// shown to anyone — and that spelling is the name of the LIVE API-error channel
// (`ApiError.userMessage`), so an author who had read that documentation and
// wrote a rule here reasonably believed they were marking a refusal for an end
// user; the failure was silent in both directions (it validated, it published,
// nothing was shown). Removal resolves the collision by deletion. Tombstoned
// with `retiredKey()`: `ConnectorSchema` is a non-strict `z.object`, so a bare
// deletion would be a silent strip (#3733, ADR-0104). The def shapes leave
// whole — `integration/ErrorMappingConfig`, `integration/ErrorMappingRule` and
// the orphaned `integration/ConnectorErrorCategory` enum, all in
// `RETIRED_DEFS_BY_MAJOR[18]`. Sources are rewritten by the D2 conversion
// `connector-error-mapping-removed` (one strip per `connectors[]` entry; the
// eleven nested keys leave with the block).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #12497 / #13823 grading).
export const entry = 'integration/Connector:errorMapping';
