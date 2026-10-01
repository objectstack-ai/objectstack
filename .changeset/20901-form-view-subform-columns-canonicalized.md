---
'@objectstack/spec': patch
---

fix(spec): a stored form view whose subform grid columns use the `field` spelling is respelled to `name` on the way in, as a relationship field's `inlineColumns` already are (#20901)

**`@objectstack/spec`**

- **New ADR-0087 conversion `form-view-subform-columns-canonicalized` (protocol 18, retired from the authoring path).** A form view's `subforms[].columns` accepted any value through 17.5.0 and now takes the inline grid column contract, which refuses `{ field: 'x' }` with the prescription naming `name`. The conversion rewrites that entry as `{ name: 'x' }`, every other key kept, wherever a form view travels as data at rest: a stored `view` row (its `form`, each `formViews` entry, a form view item's `config`, a flattened form overlay), an assembled manifest's `viewItems`, and `os migrate meta --from 17`, which lists the edit. A built artifact whose declared protocol floor is 17.5.0 or lower is converted too, not refused. An entry that already carries `name` is left alone, including one that carries both `field` and `name`: the parse names both keys, and the author picks one. It is the same respelling `field-column-lists-canonicalized` applies to a relationship field's `inlineColumns`, and both entries run one shared rule.
- **Authored sources are unchanged:** `defineStack` and `objectstack validate` do not replay a retired conversion, so a source that writes `field` on a subform column is still refused with the prescription. Write `name`.
- **Two step-18 migration entries now read true.** `inline-grid-column-currency-scale-refused` no longer says a column declaring no `type` keeps its `scale`: over a `currency` field of the child object, `defineStack` refuses it, under `inline-grid-column-identity-only-currency-scale-refused`, which the entry now names. `form-view-subform-columns-closed` names this conversion as the one mechanical edit on its carrier.
