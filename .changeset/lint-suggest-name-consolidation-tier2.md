---
"@objectstack/lint": patch
---

fix(lint): consolidate five more private "Did you mean?" copies onto the shared `suggestName` (#14577, follow-up to #14268/#14575)

`validate-action-name-refs.ts`, `validate-chart-bindings.ts` and
`validate-searchable-fields.ts` each carried a private `suggest`/`distance`
pair, byte-for-byte re-deriving the edit-distance-only budget that
`object-graph.ts` already exports as `suggestName` (the shared helper
#14268/#14575 consolidated three other rules onto). All three now import
`suggestName` from `./object-graph` and their private copies are deleted.

`validate-ai-tool-references.ts` and `validate-translation-references.ts`
each carry a one-line pre-pass ahead of the private pair — the `action_<name>`
tool-family prefix, and a snake_case namespace-segment match — that is
rule-local knowledge, not the shared helper's business. Both keep that
pre-pass and now delegate the fallback to `suggestName` instead of a private
Levenshtein copy.

The shared helper's containment pre-pass (a candidate that contains the
target, or vice versa, scores ahead of any edit-distance match) is now every
one of these five rules' behaviour too, so a hint may now appear where one was
previously absent — it never removes a hint the private copy gave. Per site:

- `validate-action-name-refs.ts` — `archive` → `archive_completed_deals`
  (17 edits, over budget) now gets a hint; unaffected cases unchanged.
- `validate-chart-bindings.ts` — the issue's own headline example,
  `amount` → `sum_amount` (4 edits, over the budget of 2) now gets a hint on
  a raw-field-instead-of-measure binding.
- `validate-searchable-fields.ts` — `amount` → `sum_amount` (4 edits) now
  gets a hint on a stale `searchableFields` entry.
- `validate-ai-tool-references.ts` — the `action_<name>` prefix pre-pass is
  unchanged and still wins first; a miss with no prefix match now also
  reaches `suggestName`'s containment scan (e.g. `knowledge_base` →
  `search_knowledge_base`), where the old private copy gave nothing.
- `validate-translation-references.ts` — the namespace-segment pre-pass is
  unchanged and still wins first; a miss with no segment match now also
  reaches `suggestName`'s containment scan (e.g. `amount` →
  `amountsummary`), where the old private copy gave nothing.

`object-graph.ts`'s helper is untouched (already ruled by #14268/#14575);
`validate-react-page-props.ts` and `validate-rule-schema-formats.ts` stay out
— both are a different contract on purpose (see #14577's triage).
