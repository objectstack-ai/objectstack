---
"@objectstack/cli": patch
---

fix(cli): `os lint` and `os i18n check` ask for an approval flow's label and each approval step's label (#24916)

Clause-②: no
Metadata-protocol: none

The approvals door names a request's flow and its current step in the reader's locale, from `flows.FLOW.label` and `flows.FLOW.approvals.NODE.label`. The i18n extractor asked for `flows.FLOW.label` only on a flow with a `screen` node, and for no approval step at all, so `i18n/missing-flow` never listed an approval flow or its steps as untranslated, and `os i18n extract` never scaffolded those keys. An app's approvals inbox could show the authoring language in every other locale under a green coverage run.

Now:

- `flows.FLOW.label` is asked for on a flow with a `screen` node or an `approval` node, the two surfaces that show it. A flow with neither, such as a record-triggered or scheduled flow that only does work, still owes no label, because nothing shows it.
- `flows.FLOW.approvals.NODE.label` is asked for on every `approval` node that has an `id`, seeded with the node's own `label`.
- Both are reported as `i18n/missing-flow` by `os lint`, listed by `os i18n check`, and written into the skeleton by `os i18n extract`. `os i18n check --help` names approval steps among the surfaces it covers.

**What you may see.** An app that ships an approval flow and declares a locale beyond its default now gets an `i18n/missing-flow` finding for each untranslated approval flow and step. Under `os lint --i18n-strict` or `os i18n check --strict` these are errors, like every other missing translation. To clear them, translate the keys in that locale's pack, for example:

```ts
flows: {
  expense_approval: {
    label: '报销审批',
    approvals: { manager_review: { label: '经理审核' } },
  },
},
```

`os i18n extract` writes the empty slots for you and keeps the strings a pack already translates. No key, schema or export changes: both keys were already part of the translation contract, and `os validate` already accepted them.
