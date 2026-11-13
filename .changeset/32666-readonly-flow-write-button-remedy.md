---
'@objectstack/lint': patch
---

fix(lint): `flow-update-readonly-field` on an autolaunched flow names the elevated flow a button can start

Clause-②: no
Metadata-protocol: none

A flow's `update_record` or `create_record` node that writes a field its object declares `readonly: true`, run as the user, is refused at `os validate`, `os build` and the publish gate, because the engine drops the value and the step still reports success. The fix line offered `runAs: 'system'` as the remedy. On an `autolaunched` flow, the type a record action button starts, that remedy breaks the button: a button, an action, an endpoint or the trigger route refuses a user an elevated `autolaunched`, `record_change` or `schedule` flow with 403 `PERMISSION_DENIED`.

On an `autolaunched` flow the fix line now says which elevated flow a button can start:

- `update_record`: `Declare the flow runAs:'system' (a button starts an elevated flow only as a 'screen' or 'api' flow, or through a subflow node), or remove 'FIELD' from this update_record node`
- `create_record`: `Stamp 'FIELD' in a beforeInsert hook on 'OBJECT', or remove it from this create_record node; runAs:'system' from a button needs a 'screen' or 'api' flow or a subflow node`

A `record_change`, `schedule`, `screen` or `api` flow keeps the fix line it had. `os explain flow-update-readonly-field` states the limit and both routes a button can reach: a `screen` or `api` flow declared `runAs: 'system'`, or a user-run flow whose `subflow` node calls the elevated flow. The rule, its severity and what it refuses are unchanged.
