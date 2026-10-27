---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@object-ui/app-shell': minor
---

feat(spec,automation,app-shell): a read-only `record_link` screen field shows a record the run created, by its display name, as a link to its record page

Clause-②: yes (widening)
Metadata-protocol: added

A screen flow can now end on a result screen that links the records it created, instead of a toast that points at nothing.

```ts
{ id: 'done', type: 'screen', config: { title: 'Lead converted', fields: [
  { name: 'account_link', label: 'Account', type: 'record_link',
    reference: 'crm_account', defaultValue: { dialect: 'cel', source: 'account.id' } },
] } },
```

- **`@objectstack/spec`**: `ScreenFieldConfigSchema` gains the `type` member `'record_link'` (`SCREEN_FIELD_RECORD_LINK_TYPE`). On it, `reference` (the record's object) and `defaultValue` (a value slot that evaluates to the record's id) are required, and `required`, `options`, `placeholder`, `min` and `max` are refused, each at its own key with the exported refusal text (`SCREEN_FIELD_RECORD_LINK_REFERENCE_REQUIRED`, `SCREEN_FIELD_RECORD_LINK_DEFAULT_VALUE_REQUIRED`, `screenFieldRecordLinkRefusedKey`). The name is `record_link`, not `record`, because `record` is already an object field type (a name-keyed map of sub-objects) and a screen field's `type` uses the same vocabulary. Every other `type` value parses as before.
- **`@objectstack/service-automation`**: the resume refuses any value sent under a `record_link` field's name, `null` included and visible or not, with `400 INVALID_SCREEN_INPUT` and the field code `invalid_value` ("shows a record and takes no value"). The value is never bound to a flow variable, the refusal keeps the pause, and a resume that leaves the field out still lands. A caller's param that shares the field's name never counts as answering the screen, so a result screen always pauses.
- **`@object-ui/app-shell`**: the flow screen dialog shows a `record_link` field as the record's display name (the object's `nameField`, through the lookup widget's read-only branch) inside a link to `/apps/APP/OBJECT/record/ID`. An empty id shows "—" with no link, and an object the console cannot route to shows the name without a link. `visibleWhen` works as on any field. The dialog never seeds or posts a value for the field.
