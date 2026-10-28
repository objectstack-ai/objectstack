---
'@objectstack/spec': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): a key-only record control, and the Studio hook form offers `refusals` with it

Clause-②: no
Metadata-protocol: none

A hook built in Studio can now declare its refusal catalogue. The hook form shows a **Refusals** row beside the body: add a code, write the message the user reads and an optional 4xx status, rename or remove a code. The saved body is exactly `refusals: { CODE: { message, status? } }`, the shape `HookSchema` accepts, so a hook made in Studio no longer has to be edited as code to refuse in translatable text.

- **`@object-ui/app-shell`.** The metadata form's `record` editor gains a key-only face. A `type: 'record'` row that declares `widget: 'key-only-record'` edits a map of closed entries (add, rename, remove, reorder, edit each entry's fields) and never writes the key into the entry. A key is checked against the record's served key rule (`propertyNames.pattern`, derived from the spec), so a code like `clean_version` is refused before it reaches the draft. A rename moves the entry in place once the new key is valid. A record row with no such widget behaves as before: the key is still mirrored into each entry.
- **`@objectstack/spec`.** `hookForm` offers `refusals` with that control. `HookSchema` is unchanged.
- **`@object-ui/i18n`.** One new Studio string, `engine.form.key` (en, zh), which names the key column when the form declares no key label.
