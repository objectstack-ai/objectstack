---
'@objectstack/skills': patch
---

docs(skills): `objectstack-data` and `objectstack-formula` state that `previous` is `null` on insert — `previous == null` judges an insert, a column read off it there faults, and only a write to an existing row whose prior state is not in hand leaves it unbound (#23983)

Clause-②: no

`skills/objectstack-data/references/data-hooks.md` and `skills/objectstack-formula/SKILL.md` said `previous` is unbound on insert events and told authors to write insert-event conditions over `record` alone. Since `@objectstack/objectql` binds `previous` to `null` on insert in validation rules and declarative hook conditions (the binding a flow's start condition already had), that text was false: `previous == null || …` judges an insert and `previous != null && …` skips one; only a column read off `previous` on insert (`previous.status`) still has no value and still fails the write, and only a write to an existing row whose prior state is not in hand leaves `previous` unbound, failing closed. The bullet, the scope-table row, the abort note and the legacy-translation note now state that binding and the `null` guard; the `record`-alone advice stays correct and is no longer presented as the rule. Text only; nothing an author writes changes, and a hook's `ctx.previous` is unchanged.
