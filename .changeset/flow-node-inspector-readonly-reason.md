---
'@object-ui/app-shell': patch
---

fix(app-shell): a read-only flow node inspector says why its controls are disabled, on hover, on keyboard focus and to assistive tech

Clause-②: yes (widening)
Metadata-protocol: none

On a read-only package, Studio's flow node inspector disabled every control (ID, Label, Node Type, the config fields, Remove node) and gave no reason anywhere: no tooltip, no accessible description, and Tab skipped the whole panel. The inspector body now carries the treatment Studio's field rail and validation-rule editor carry: it is a tab stop described by the reason, and hovering any disabled control in it shows the reason in a tooltip.

The reason is the host's to give, because the inspector is shared by hosts whose read-only causes differ. `MetadataInspectorProps` gains an optional `readOnlyReason?: string`; an inspector that honours it draws the reason while `readOnly` is true. Studio's Automations pillar passes the read-only package sentence. A host that passes nothing renders exactly as before.
