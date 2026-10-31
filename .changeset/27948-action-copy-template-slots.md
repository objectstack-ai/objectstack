---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

feat(spec)!: an action's `description`, each param's `helpText` and each `outcomeMessages` entry are `template` slots; the doors refuse `${…}` there

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered action-dialog-outcome-copy-template-holes -->

Step 2 of #27948 (ruling A): the five action copy keys speak one hole syntax, ADR-0032's `{{ }}`. `confirmText` and `successMessage` already did (#24814); the param dialog's `description`, each param's `helpText` and each `outcomeMessages` entry now join them.

- **The parse.** Each of the three is typed as `confirmText` is: a bare string is shorthand for `{ dialect: 'template', source }` and parses to that envelope; the envelope is taken; `description` and an `outcomeMessages` entry keep the inline locale map they took as an `I18nLabel`, and `helpText` stays without one (it was a plain string). A blank string and a `${…}` sentence still parse, so a stored action loads.
- **The roots.** `description` and `helpText` read `confirmText`'s roots: `record`, the record the action runs against (a registered action's `params` is the input list the dialog collects, so it binds nothing). An `outcomeMessages` entry reads `successMessage`'s: `result`, the handler's answer, and `record`.
- **The doors.** `objectstack validate`, `compile` and the publish gate (422) judge each sentence through the same judge as `confirmText`: a `${…}` token, a single-brace `{x}` token, a hole over a root the runner does not bind, a hole holding logic or an unknown formatter, and a blank sentence are errors, each named at its own path (`description`, `params[N].helpText`, `outcomeMessages.OUTCOME`) with its `{{ }}` spelling. An inline `properties.action` is judged on its params' `helpText`.
- **The readers.** The CLI's i18n extraction seeds the envelope's text exactly as the bare string's, and the MCP `list_actions` param description reads `helpText`'s text, never the object.
- **The platform's own copy** is rewritten: the invite actions' outcomes (`Invitation sent to {{ result.email }}`), `resend_invitation`'s and `update_member_role`'s descriptions, the role-change `permission_set_granted` outcomes, and their four translation bundles.

What to do (FROM → TO, on `description`, `params[].helpText` and `outcomeMessages` entries):

- `Resend the invitation to ${record.email}?` → `Resend the invitation to {{ record.email }}?`
- `Invitation sent to ${result.email}` → `Invitation sent to {{ result.email }}`
- `${record.owner?.name ?? 'nobody'}` → `{{ record.owner.name | default:'nobody' }}` (the `default` formatter also covers an empty value)
- other logic in a `${…}` token moves into the handler's answer and is read from `result`.

The console keeps filling `${…}` in a stored sentence with no `{{ }}` hole, so stored copy reads as before until its next save, which is judged. `os migrate meta` lists the change (`action-dialog-outcome-copy-template-holes`); no conversion is registered, since a `${…}` token held an expression and a hole holds only a path and formatters.

A TypeScript reader of a parsed `ActionSchema` now meets the envelope on these three keys: read its text with `templateSlotSource` (`@objectstack/spec/automation`).
