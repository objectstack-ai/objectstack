---
'@objectstack/skills': patch
---

docs(skills): teach an action param's `widget` key in the action dialog

Clause-②: no
Metadata-protocol: none

- `objectui` (`rules/protocol.md`, inline params): the widget-config list gains `widget`. It names a registered field widget that draws the param instead of its `type` widget (`'permission-ref'` on a `text` param is the permission-set picker); an unregistered name keeps the `type` widget, and the selection bar's bulk dialog does not read it. The server still validates the submitted value by `type`.
- `objectstack-ui` (`rules/actions.md`, field-backed params): a field-backed param inherits the field's `widget` only while it keeps the field's `type` or restates it; a param that overrides `type` names its own `widget`.
- Paid inside the token ceilings by removing restatements in the same files. No schema, key or behaviour changes.
