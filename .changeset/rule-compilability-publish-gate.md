---
"@objectstack/lint": patch
---

fix(lint): reject a validation rule whose regex or JSON Schema does not compile, at authoring time (#4762)

Two of the six object validation-rule types carry a **static artifact** that the
write path hands to a real compiler, inside a `try/catch` that logs and returns
`null`:

- `format` → `new RegExp(rule.regex)` → *"Validation rule '…' has an invalid regex — skipped"*
- `json_schema` → `ajv.compile(rule.schema)` → *"Validation rule '…' has an uncompilable JSON Schema — skipped"*

"Skipped" means the rule is declared, appears in the metadata, appears in every
"what protects this object" listing — and enforces nothing, on every record, for
as long as the metadata is deployed, with a WARN line in a log nobody reads as
the only signal. That is the shape #4649 was filed about one rule type over;
#4761 flipped the CEL predicates to fail closed and deliberately left these two,
because their blast radius differs (see below).

**New gate — `validateRuleCompilability`**, a `gating` entry in
`AUTHORING_RULES`, so it runs on all three authoring commands (`os validate`,
`os build`, `os lint`) with no per-command wiring. Two rule ids:

| id | fires when |
|:---|:---|
| `validation-rule-regex-uncompilable` | a `format` rule's `regex` throws in `new RegExp(...)` |
| `validation-rule-json-schema-uncompilable` | a `json_schema` rule's `schema` throws in `ajv.compile(...)` |

Each finding names the rule, the object and the config path, and carries the
**compiler's own error text verbatim** — an author cannot act on "invalid
regex", but can act on `Invalid regular expression: /([/: Unterminated character
class`. Rules nested in a `conditional`'s `then` / `otherwise` are judged too
(`evaluateRule` recurses into them and reaches the very same checkers), and the
finding names the branch it is in.

**Detection is the real compilers, never a pattern that judges a pattern.** The
regex is compiled with `new RegExp(source)` — the exact call `checkFormat`
makes. The schema is compiled with ajv constructed with the **same options the
runtime's shared instance uses** (`{ allErrors: true, strict: false }`), read
back out of `rule-validator.ts`'s source by a parity test so the day those
options change, this gate is told rather than left quietly disagreeing.
`strict: false` is load-bearing in both directions: a gate running `strict: true`
would reject author-written schemas carrying vendor keywords that the write path
compiles happily — a gate that turns working metadata red gets switched off, and
then protects nothing.

`ajv` is a new dependency of `@objectstack/lint`, loaded **lazily**: only a
stack that actually declares a `json_schema` validation rule pays for it, pinned
by the package's `lazy-deps.test.ts` alongside `typescript` and `sucrase`. The
kernel boot path (`@objectstack/lint/runtime`) never loads it at all.

**The runtime half is deliberately unchanged.** `rule-validator.ts` still fails
open on both, and the `#4649 — unchanged neighbours` pins that record it stand
exactly as they are. A broken regex or schema is *static* — decidable from the
metadata alone, with no record in hand — so the authoring door closes the class
outright without ever bricking a running deployment, whereas rejecting at write
time would reject **every** write touching that field for as long as the bad
metadata is deployed. Whether a runtime backstop is still wanted on top of a
closed authoring door stays open on #4762.
