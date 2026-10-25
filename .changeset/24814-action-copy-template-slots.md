---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
'@objectstack/platform-objects': minor
'@objectstack/plugin-approvals': minor
---

feat(spec,lint): an action's `confirmText`, `successMessage` and `errorMessage` are `template` slots over the roots the console's runner binds

Clause-②: yes (widening)
Metadata-protocol: semantic

- **Before.** On the page action rows (`action:button`, `action:icon`, an `action:group` / `action:menu` member) the three copy keys were plain `z.string()`s, and on a registered action `confirmText` / `successMessage` were `I18nLabel`s. None declared a hole. The console filled `${…}` in them (`${record.name}` in a confirm, `${result.email}` in a success toast), and the platform's own sentences were written that way.
- **Now.** Each is an ADR-0032 `template` slot (Decisions 2–3), the same mechanism as a bulk action's `confirmText`. A bare string is shorthand for `{ dialect: 'template', source }`, and the envelope is accepted too. Holes are `{{ path }}` and `{{ path | formatter[:arg] }}`, with formatters from the template engine's whitelist and no logic inside a hole. They read a closed scope, the one the console's action runner binds, declared in `@objectstack/spec/ui`:
  - `confirmText`: `record`, the record the action runs against, and `params` only when the action's `params` is an object of static values (`actionConfirmTemplateRoots(action)`). An input list binds nothing, because its values are collected after the confirmation.
  - `successMessage`: `result`, the payload the handler answered, then `record` (`ACTION_SUCCESS_TEMPLATE_ROOTS`).
  - `errorMessage`, on the rows only: no root (`ACTION_ERROR_TEMPLATE_ROOTS`). The runner shows it as written.
- **Parsed shape.** A parsed copy key is now the `{ dialect: 'template', source }` envelope rather than a string. A reader of the parsed or served definition takes the text from `source` (`templateSlotSource` in `@objectstack/spec/automation` reads both forms). The console pinned by this release reads both. A registered action keeps its inline locale map, and a blank string still parses as itself.
- **Judged at the doors, as warnings.** `objectstack validate`, `objectstack compile` and the publish gate (on `action`, `object` and now `page` writes) judge every sentence through `closedScopeTemplateRefusal`, the template judge's closed-scope entry, then compile it as a template. A hole over a root the runner does not bind, a `${…}` or single-brace `{x}` token, a hole holding logic or an unknown formatter, and a blank sentence are each named. Each locale of an inline map is judged on its own. Every finding is a **warning**, an advisory at the publish gate and never a refusal, so no command's exit code changes: each of these texts parsed while the keys were plain strings.
- **`${…}` is prescribed its hole.** The judge reads a `${…}` token with its `$`, so `Delete ${record.name}?` is told to become `Delete {{ record.name }}?`. It no longer says `Delete ${{ record.name }}?`. A slot with no root names every hole and token in it as literal text.
- **The platform's sentences.** The `invite_user` success toast on `sys_invitation`, `sys_member`, `sys_organization` and `sys_user` (`Invitation sent to {{ result.email }}`) and the nine `sys_approval_request` decision toasts (`Approved "{{ result.request.record_title }}"`, …) now use `{{ }}` holes, in every shipped locale. The console fills them the same way.
- **Translation and extraction.** `translateAction` answers the authored envelope when no translation applies, and a translated sentence as a string. `os i18n extract` seeds an envelope-form `confirmText` / `successMessage` exactly like the bare string.
- **Unchanged.** `ActionSchema.errorMessage` and `outcomeMessages` are untouched (`outcomeMessages` still reads `${result.*}`), and so are `emptyText` and every other key. Producers measured at `e649c2d91e`: 13 authored copy sentences carried `${…}` (the 13 above) and none carried `{{`. After this change none carries `${…}`, and none in `examples/**`.
