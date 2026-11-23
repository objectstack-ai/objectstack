---
'@objectstack/lint': patch
'@objectstack/spec': patch
---

fix(lint)!: ten publish-time checks for flows that save and do not run — seven refuse the publish, three warn

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: follow-up owed — skills/objectstack-automation/SKILL.md, skills/objectstack-automation/references/examples-flows.md

<!-- adr-0087: registered publish-refuses-flows-that-save-and-do-not-run -->

**BREAKING** for the publish of a flow that carries one of the seven errors below: it was accepted before and is refused now, with the fix named in the finding. The schema is unchanged and stored flows are not rewritten or refused at boot; the refusal comes at the next publish, and from `os validate` / `lint` / `compile` / `build`.

Seven errors, run by the runtime publish gate and the CLI:

- `flow-trigger-object-missing`: a record-triggered flow with no `objectName` registers its hook with no object, so it fires on writes to every object.
- `flow-condition-option-label`: a start condition compares a select field with one of its option labels (`record.stage == 'Closed Lost'`) where the row holds the option value (`closed_lost`), so it is never true. Judged only when the field's options are inline in this stack.
- `flow-time-relative-shadowed`: a `timeRelative` block under a record `triggerType` never sweeps, because a record trigger wins.
- `flow-time-relative-key-misplaced`: `filter` or `maxRecords` written beside `timeRelative` is ignored; the sweep reads them only inside the block.
- `flow-time-relative-date-field-invalid`: a `timeRelative.dateField` the swept object does not have, or that is not a `date` / `datetime` field, matches no record. Judged only when the stack declares the object; `created_at` / `updated_at` count as datetime fields.
- `flow-node-write-unknown-option`: a create / update node writes a select field a literal no option carries; the record validator refuses it `invalid_option` on every run. When the literal is an option's label, the finding names its value.
- `flow-node-write-date-helper-text`: a create / update node writes a date field the text of a helper call (`'today()'`); the validator refuses it `invalid_date`. The fix is a CEL value envelope, `{ dialect: 'cel', source: 'isoDate(today())' }`.

Three warnings, which refuse nothing and make `os validate --strict` exit 1 as any warning does:

- `flow-schedule-timezone-missing`: a schedule or time-relative cron with no `timezone` runs in UTC.
- `flow-subflow-unknown` (CLI only, new rule `validateFlowSubflowTargets`): a `subflow` / `map` node names a flow this stack and its packages do not carry. The publish gate sees one flow at a time, and another package may ship the called flow, so it is not judged there.
- `flow-create-update-pair`: an after-create flow and an after-update flow on the same object with the same nodes; one flow on `triggerType: 'record-after-write'` does both (on the create run `previous` is null). Judged on the CLI, where the stack holds both flows.

## FROM → TO

- a start node `{ triggerType: 'record-after-update' }` with no `objectName` → `{ triggerType: 'record-after-update', objectName: 'deal' }`.
- `record.stage == 'Closed Lost'` → `record.stage == 'closed_lost'`.
- `triggerType: 'record-after-update'` plus `timeRelative` → keep the one the flow means.
- `{ timeRelative: {...}, filter, maxRecords }` → `{ timeRelative: { ..., filter, maxRecords } }`.
- `fields: { stage: 'Closed Lost' }` → `fields: { stage: 'closed_lost' }`.
- `fields: { due_on: 'today()' }` → `fields: { due_on: { dialect: 'cel', source: 'isoDate(today())' } }`.

New exports from `@objectstack/lint`: `validateFlowSubflowTargets` and the rule ids `FLOW_TRIGGER_OBJECT_MISSING`, `FLOW_CONDITION_OPTION_LABEL`, `FLOW_TIME_RELATIVE_SHADOWED`, `FLOW_TIME_RELATIVE_KEY_MISPLACED`, `FLOW_TIME_RELATIVE_DATE_FIELD_INVALID`, `FLOW_SCHEDULE_TIMEZONE_MISSING`, `FLOW_SUBFLOW_UNKNOWN`, `FLOW_NODE_WRITE_UNKNOWN_OPTION`, `FLOW_NODE_WRITE_DATE_HELPER_TEXT`, `FLOW_CREATE_UPDATE_PAIR`. `@objectstack/spec` adds only the upgrade-guide entry `publish-refuses-flows-that-save-and-do-not-run`.
