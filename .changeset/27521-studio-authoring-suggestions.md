---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(studio): plainer authoring in Studio — option labels first, named validation rules, labelled condition fields, object labels on flow cards, honest field counts, a Create that says why it is off, and a publish toast that points to Access

Clause-②: no
Metadata-protocol: none

- **Picklist options** read Label first, and a new option's stored value is filled in from its label until the author types one, so three labelled options are three saved options. An authored option's value never moves when it is relabelled. The lifecycle kind (Open / Won / Lost) is offered only on the field the record path follows, or where an option already declares one.
- **Validation rules**: a new rule's API name follows its message (`Hours over 40` → `hours_over_40`) until the name is edited; an authored rule keeps its name. The condition builder lists fields by label, with the CEL spelling beside it, under "Pick a field". The rule type, severity and name labels are in plain words.
- **Flow canvas**: a node card names the object it works on by the object's label.
- **Object header**: counts the fields the canvas shows, and the platform's own columns apart (`2 fields (+8 system)`); "1 field" is singular.
- **Add field**: a Create that cannot run yet stays focusable and says what is missing.
- **Read-only inspectors**: disabled text areas take the muted disabled look.
- **Publish**: the "one atomic release" wording is plain ("together: all of them go live, or none do"), and a publish that put an app or object live says members need a permission set, with an "Open Access" action.
- **Studio access refusal** names who grants access (an administrator, in Setup → Permission Sets), in `en` and `zh` and in the Console's own fallback sentence.
