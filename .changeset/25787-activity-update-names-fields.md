---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity entry for an update that moves no `trackHistory` field names the fields that changed

Clause-②: no
Metadata-protocol: none

The record Discussion feed wrote `Updated <object> "<label>"` for every update that fired no milestone and changed no `trackHistory` field, so a record a roll-up, flow or seed updates repeatedly showed a run of identical entries with nothing to tell them apart. That entry now names the changed fields by label, in declaration order: `Updated Campaign "CPG-0001": Number Sent, Responses, and Leads`. Values are still rendered only for `trackHistory` fields; an untracked field's value never reaches the text.

At most five fields are named and the rest counted (`…, and 3 more`), and fewer are named when the text would exceed the `maxLength` declared on `sys_activity.summary`. Each named or counted field is recorded as a source of the summary, so a reader not served one of those fields is served the entry without its summary, as for a tracked-change entry. Two message keys are added to the plugin's en, zh-CN, ja-JP and es-ES bundles, `messages.activityUpdatedFields` and `messages.activityMoreFields`. A locale bundle that defines `messages.activityUpdated` but not `messages.activityUpdatedFields` keeps its field-less sentence.
