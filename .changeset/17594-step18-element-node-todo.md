---
"@objectstack/spec": patch
---

fix(spec): the 17 → 18 chain now NAMES the bare `element:filter` / `element:form` node it leaves behind, instead of ending schema-invalid in silence (#17594)

`element:filter` and `element:form` were retired whole at element grain, and the
two ADR-0087 D2 conversions that carry the retirement — `element-filter-removed`
and `element-form-removed` — strip every authorable key and **deliberately leave
the bare component node**: deleting an authored page node changes a page's
layout, which a mechanical conversion must not decide. That residue was inert
until both names joined `RETIRED_PAGE_COMPONENT_TYPES` and the parse began
refusing them by name — at which point deleting the node stopped being optional
and became a required step of the upgrade.

The chain never said so. Measured on a stack carrying both nodes, before this
change:

```
os migrate meta --from 17 --to 18

  --json        schemaValid: false
  human path    "Migrated stack does not yet pass schema validation —
                 resolve the manual changes above"
  the 115 step-18 todos    0 name `element:filter`, `element:form`,
                           `ElementFilter` or `ElementForm`
```

ADR-0087 D3 requires a structured TODO "rather than silence" for a migration
step that cannot be expressed declaratively, and this is one: only the author
knows what their region should hold once the node is gone. The new
`element-filter-and-form-node-refused` semantic entry supplies it — surface, the
two replacements (`userFilters` for the filter, the object-bound `object-form`
block for the form) and an `os validate`-clean acceptance criterion — so
`os migrate meta` and the generated upgrade guide both name the thing to delete.

⛔ Nothing about either conversion's behaviour changes: they still strip the keys
and still leave the node, and no node is deleted for the author.

<!-- adr-0087: registered element-filter-and-form-node-refused -->
