---
"@objectstack/spec": patch
---

chore(spec): mark FormView `buttons`/`defaults` live now the ObjectUI renderer folds them (#1894)

The structured `FormViewSchema.buttons` (per-button `submit`/`cancel`/`reset`
visibility + label) and `defaults` (create-mode initial values) shipped under
the ADR-0078 escape hatch — declared, but carrying an `[EXPERIMENTAL — NOT
ENFORCED]` marker because no consumer read them yet. The ObjectUI `ObjectForm`
renderer now folds both onto the flat props it reads
(`showSubmit`/`submitText`/`showCancel`/`cancelText`/`showReset`/
`initialValues`), so the escape-hatch marker is dropped and the two spec
liveness-ledger entries (`view.form.buttons`, `view.form.defaults`) flip
`experimental → live`.

No shape or parse-behavior change — both keys were already accepted. This
closes the `view` half of the inverse-drift cleanup (renderers reading
undeclared props), umbrella #1878.
