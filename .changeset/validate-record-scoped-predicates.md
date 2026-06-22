---
"@objectstack/cli": minor
"@objectstack/formula": patch
---

build: extend ADR-0032 predicate validation to all flat record-scoped sites

Builds on the action-predicate guard. `os build` now also validates these
record-scoped predicates for bare field references (`status` instead of
`record.status`), which otherwise evaluate to nothing at runtime and silently
mis-behave:

- **field conditional rules** — `requiredWhen`, `readonlyWhen`,
  `conditionalRequired`, `visibleWhen` (server-enforced; a broken one is
  fail-open — the required/readonly rule just never fires);
- **sharing-rule `condition`** (security-critical — decides which rows a
  principal sees);
- **lifecycle hook `condition`** (skips the handler when false);
- **nested `when`** on `conditional` validation rules (previously only the
  top-level rule predicate was checked).

`@objectstack/formula`: adds `parent` to the record-scope namespace roots —
master-detail inline grids inject the header record as `parent` for a child
field's `readonlyWhen`/`requiredWhen` (ADR-0036, #1581), so `parent.status` is
legitimate, not a bare ref. Verified against the full monorepo build (76 tasks
clean).

Not yet covered (separate follow-up — needs a recursive view/page tree walker
and per-node scope classification): deeply-nested UI visibility predicates
(`view` element/section `visibleOn`/`condition`, `page` component `visibility`),
object field-group `visibleOn`, and app-nav `visible` (user/feature-scoped, not
record-scoped).
