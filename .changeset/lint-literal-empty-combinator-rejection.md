---
"@objectstack/lint": minor
---

feat(lint): literal empty combinators are refused at authoring time, with a per-shape prescription (#5330)

#5322 settled what an empty combinator MEANS at run time — the boolean identity
reduction — and #5659/PR #6528 made that reduction one implementation
(`reduceFilterVerdict` in `@objectstack/spec/data`, proven against
`FILTER_LOGIC_CASES`, consumed by every backend). This change adds the other half
the ruling deliberately left open: the literal SPELLINGS are now refused where an
author writes them, which is Prime Directive #12's standard shape (reject at the
producer, do not tolerate at the consumer) and #5240's same-direction precedent
one shape over.

`validateEmptyCombinators` is a new gating rule in `AUTHORING_RULES`, so it runs
on `os validate` / `os build` / `os lint` at once, and on the runtime publish
gate for `flow` writes — the door a Studio tenant, a REST `/meta` client and an
MCP/AI author all use. Two rule ids:

- `filter-empty-combinator` — a literal `$and: []`, `$or: []` or `$not: {}`.
- `filter-empty-node` — a literal `{}` standing as the whole filter, or as a
  branch of `$and` / `$or`.

**The prescription is per shape, because the identities disagree.** `{$and: []}`
and `{}` reduce to TRUE (match EVERY row); `{$or: []}` and `{$not: {}}` reduce to
FALSE (match NO row). A generic "empty combinator, fix it" message teaches the
wrong fix half the time, so each shape names its own: delete the key to mean "no
filter"; fill the array to mean a constraint; put the negated condition inside
`$not`; and, when zero rows really is the intent, `{ <field>: { $in: [] } }` is
the declared spelling that says so instead of implying it. The row-set wording in
every message is DERIVED from `reduceFilterVerdict` rather than retyped, and a
test drives the four #5322 identity cases straight out of `FILTER_LOGIC_CASES` and
asserts the message agrees with the rows the table says the filter selects.

**Nothing at run time changed.** No translate or evaluation path is touched, the
conformance matrix is untouched, and a stack that ignores the finding runs exactly
as before. The literal-vs-programmatic boundary the ruling requires is structural,
not heuristic: this rule sees only values that reached the metadata graph, so a
producer that assembles zero disjuncts while serving a request — an RLS lowering,
a CEL `!expr`, a client-built query — never reaches it and keeps the runtime
identity, which is what makes `{$or: []}` = zero rows fail-closed (#5134).

Also internal: the filter-subtree traversal `validate-filter-tokens.ts` grew for
#3574 moved to a shared `filter-walk.ts` now that it has a second consumer — the
same argument `page-walk.ts` (#3583) and `view-walk.ts` (#6381) make. Each rule
still declares its OWN surface list, so one rule's widening cannot land silently
in the other; `validate-filter-tokens`'s behaviour is unchanged.
