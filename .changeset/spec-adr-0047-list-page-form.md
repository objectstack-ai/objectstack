---
"@objectstack/spec": minor
---

feat(spec): ADR-0047 — list pages hide region/data-context, interface section prominent

Reorganizes the page form (`page.form.ts`) so interface/list pages get a lean,
relevant panel instead of the generic page-form dump:

- Data Context + Layout sections gain `visibleOn` `data.type != 'list'` (region
  designer / page object don't apply to a list surface).
- Interface section becomes primary content (`collapsed: false`, named for i18n).
- `interfaceConfig` sub-fields reordered (common first, rare last); `source`
  gets the `ref:object` picker; `sourceView`/`userActions`/etc. gain helpText.
- `type` field helpText notes `'list'` = interface page.
