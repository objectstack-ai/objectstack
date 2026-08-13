---
"@objectstack/spec": minor
"@objectstack/types": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

The ADR-0114 D3 mapper (Zod issue codes → the closed `FieldErrorCode` catalog) is now
`zodIssuesToFields`, exported from `@objectstack/spec` (`@objectstack/spec/api`), and it is
the ONE implementation of D3's table in the repo (#8124).

Why: `fields[].code` is declared as a closed catalog (`FieldErrorCode`, ADR-0114 D2), but
`@objectstack/types`' `fieldsFromZodIssues` — the helper the runtime `/analytics`,
`/notifications` and `/automation` entry refusals emit through — passed Zod's own issue
codes through verbatim. A refusal carrying `unrecognized_keys` / `too_small` did not parse
against the schema the protocol declares for it, and the same wire slot spoke two
vocabularies depending on which route served it.

What changed on the wire (all three runtime domain routes):

- `fields[].code` values are now catalog members: `unrecognized_keys` → `unknown_field`,
  `too_small` → `min_length`/`min_value`/`min_items` (by origin), `too_big` → the `max_*`
  mirrors, enum misses → `invalid_option`, `custom` and any unmapped Zod code →
  `invalid_value`.
- A rejection behind a `z.union` is expanded per #5014: the union's own entry is followed
  by the branch entries that explain it, so entry count is no longer issue count.
- Two hand-spelled `unrecognized_keys` literals (the analytics `filters` hint and the
  automation toggle unknown-key refusal) now say `unknown_field`, the catalog member.

`@objectstack/rest` re-exports the shared implementation from `rest-server.ts` and its
behavior is unchanged (its own mapper tests pin that); `fieldsFromZodIssues` keeps its
signature (plus an optional trailing `input` that upgrades a missing required property from
`invalid_type` to `required`, per the D3 table) and keeps the `'(body)'` spelling for
root-level failures.
