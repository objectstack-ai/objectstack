---
"@objectstack/spec": patch
"@objectstack/lint": patch
"@objectstack/cli": patch
---

feat(spec,lint): freeze the `{current_user_id}` filter vocabulary and fail the build on unresolvable placeholders (#3574)

A dashboard widget filtered on `{current_user}` rendered `0`. Not an error — a
zero, indistinguishable from a metric that is legitimately empty, with nothing
in the console or the server log. `service_dashboard.my_open_cases_by_priority`
in the HotCRM template had shipped broken this way since the day it was
written.

The token had never been part of the contract. Date macros were frozen in
`date-macros.zod.ts` with a spec vocabulary, a lint-usable predicate, and a
single client resolver; `{current_user_id}` had only prose in an `app.zod.ts`
JSDoc and three ad-hoc client implementations that each handled one surface's
filter shape. Nothing could tell an author their token was wrong.

- **`@objectstack/spec`** — new `data/context-tokens.zod.ts` freezing
  `CONTEXT_TOKENS` (`current_user_id`, `current_org_id`) as the sibling of
  `DATE_MACRO_TOKENS`, with `isContextToken` / `isKnownFilterToken` /
  `classifyFilterToken` and a `CONTEXT_TOKEN_SUGGESTIONS` near-miss table. The
  module documents what the tokens are *not*: presentation scope, never an
  access boundary — that is RLS, which uses the unrelated `current_user.id`
  expression root.
- **`@objectstack/lint`** — new `validateFilterTokens` (rule
  `filter-token-unknown`, severity `error`). It walks `filter` / `filters` /
  `runtimeFilter` subtrees across dashboards, objects, views, reports,
  datasets, pages and apps, and reports any placeholder that resolves in
  neither vocabulary. It scans for filter *keys* rather than enumerating known
  surfaces, so a new surface following the convention is covered the day it
  ships — enumerating surfaces is how the dashboard was missed in the first
  place. Navigation `recordId` / `params` are deliberately out of scope: they
  resolve `AppContextSelector` ids, which are meaningless in a filter.
- **`@objectstack/cli`** — the gate runs in `os validate` and `os compile`.

It is an error rather than a warning because of who authors this metadata. An
AI reads a query returning `0` as a correct answer and builds on it; its
correction loop is author → validate → fix, so a diagnostic only reaches it if
it can fail the build. The three spellings the suggestion table covers —
`{current_user}`, `{user_id}`, `{organization_id}` — are each correct
*somewhere else* in the platform, which is exactly why authors reach for them.

Also fixes a `ViewSchema` JSDoc example that documented `{user_id}`, a token
that resolves nowhere.
