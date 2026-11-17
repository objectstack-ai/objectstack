---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/platform-objects': patch
'@object-ui/i18n': patch
---

feat(spec, lint, i18n): an action answer table's column headers have a translation bundle key

Clause-②: yes (widening) — `ActionResultDialogTranslationSchema` and the action `preflight` translation node accept a new optional `columns` map, `columns.<field path>.<column path>` (both keys literal, dots included), beside `fields`; every bundle that parsed before parses unchanged and reads the same.
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-i18n/SKILL.md

A `format: 'table'` field in an action's `resultDialog.fields` or `preflight.fields` declares `columns: [{ path, label }]`, and each column's `label` is translatable, but no bundle key carried it, so a table's headers stayed in the authored language in every locale. The key is `objects.<object>._actions.<action>.resultDialog.columns.<field path>.<column path>` (and `….preflight.columns.…`; `globalActions.<action>.…` for an object-less action):

```ts
resultDialog: {
  fields: { rows: '逐行结果' },
  columns: { rows: { email: '邮箱', 'error.message': '未添加的原因' } },
}
```

- `os i18n extract` lists one key per labelled column, `os validate` refuses a column key that names no declared table field or column (`translation-target-unknown`), and `resolveActionResultDialog` / `resolveActionPreflight` (so `translateAction` and the served metadata) and the console's `useObjectLabel` overlay the translated header; a column with no key keeps its authored label.
- The platform bundles carry the nine column headers of `sys_user.import_sso_users`'s result table in every shipped locale.
