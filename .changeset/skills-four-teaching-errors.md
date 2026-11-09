---
'@objectstack/skills': patch
---

docs(skills): validation examples guard nullable fields, hooks teach `body`, the `requires:` table names `mailbox` and `package-registry`, `os generate` drops `agent`

Clause-②: no
Metadata-protocol: none

`objectstack-data` `rules/validation.md` now guards every ordering or arithmetic operand in its examples with `!= null` (the due-date, date-range, amount, discount and order-total predicates) and states the rule once: an unguarded `<` or `+` on a field with no `required: true` / `defaultValue` is refused at publish. Its external-validation hook and the `examples-objects.md` lifecycle hook are written as a sandboxed `body`, and the `SKILL.md` index names the inline `handler` only as the deprecated form; the validation section says a `body` has no outbound HTTP, so an external-API check goes through a Connector recipe. `objectstack-platform` lists `mailbox` (`@objectstack/service-mailbox`) and `package-registry` (`@objectstack/service-package`) in the `requires:` table, and `references/operations.md` no longer offers the retired `os generate agent`. The platform behaviour already shipped; this release only teaches it.
