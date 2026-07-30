---
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/rest": patch
---

feat(spec,objectql,rest): publish the audit-provenance and import-coercion vocabularies (#3786, #4173)

Two more hand-copied lists retired the same way, each replaced by one spec
export and derivation at every consumer.

**`AUDIT_PROVENANCE_FIELDS`** (`@objectstack/spec/data`, with the
`AuditProvenanceField` type) — the four columns `applySystemFields` injects on
every audit-tracked object: `created_at`, `created_by`, `updated_at`,
`updated_by`. That four-name list existed in at least four copies across two
repos: the registry's injection if-chain, the rule-validator's `preserveAudit`
allowlist ("Kept in sync with the registry's auto-injected audit fields" — by
nothing), and two objectui render surfaces. Now:

- the registry's injection is table-driven, keyed by the tuple with a
  `satisfies Record<AuditProvenanceField, …>` clause — a name added to the spec
  without a column definition (or vice versa) is a compile error, the
  `APPROVER_VALUE_BINDINGS` discipline;
- the rule-validator's `AUDIT_TIMELINE_FIELDS` derives from the same tuple;
- `FIELD_GROUP_SYSTEM_FIELDS`' audit prefix derives from it too — one
  declaration even inside the file that hosts both;
- objectui's `AUDIT_FIELD_BY_ROLE` already pins itself by subset assertion and
  can import the tuple directly once this release is published.

Injection behaviour is byte-identical — a conformance test pins every injected
column's shape against the pre-refactor definitions.

**`IMPORT_BOOLEAN_TRUE_TOKENS` / `IMPORT_BOOLEAN_FALSE_TOKENS` /
`IMPORT_REFERENCE_TYPES`** (`@objectstack/spec/data`) — the `/import` coercion
vocabulary #4173 asked for. The server's `import-coerce.ts` now derives its
`BOOL_TRUE` / `BOOL_FALSE` / `REFERENCE_TYPES` from these instead of owning
them privately, and objectui's Import Wizard preview — which re-checks the same
contract client-side so a cell is flagged red exactly when the server would
reject it — can retire its pinned-inventory mirror once this release is
published (the retirement path is written in that file's own header).
`IMPORT_REFERENCE_TYPES` ships with the legacy `'reference'` spelling included,
retiring the `+ 'reference'` literal both ends carried separately. The tables'
own discipline is tested: sets disjoint, every token pre-normalized
(lower-case, trimmed), and the Chinese / check-mark spreadsheet-reality tokens
pinned by name.

No behaviour change anywhere: every derived value is byte-identical to the
literal it replaces.
