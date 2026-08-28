---
"@objectstack/spec": patch
"@objectstack/lint": patch
---

Correct three stale `current_user` binding claims about a form FIELD `visibleWhen`

A runtime form field's `visibleWhen` has resolved `current_user` — and the ADR-0068 D1 aliases `user` / `ctx.user` / `os.user` — since objectui#6010, but three texts shipped by these two packages still told authors the root was unbound there, and that per-option `visibleWhen` was "the only `*When` surface where it resolves".

- `@objectstack/spec`: `FormFieldSchema.visibleWhen`'s doc block and its `describe()` now state the binding together with the two limits it does not remove — it is a rendering rule that nothing on the write path evaluates, so a role test written there protects no data; and the scope belongs to the host, so it is empty on the console's public standalone form route, where the predicate faults and visibility fails open. The generated `content/docs/references/ui/view.mdx` rows follow from the `describe()`.
- `@objectstack/lint`: the field-rule prescription no longer grounds "move it to the option's own `visibleWhen`" on exclusivity. It grounds it on enforcement — the rule validator evaluates a per-option predicate on every write — and names the form-view field predicate only to refuse it as a destination for a server-enforced object rule, since moving one there would trade a loud lint error for a silent enforcement gap.

No schema, validation or verdict change: the set of accepted metadata is byte-identical, and the rule still refuses a user root on an object field-level `*When`.
