---
'@object-ui/app-shell': patch
---

fix(app-shell): a read-only flow edge inspector says why its controls are disabled, on hover, on keyboard focus and to assistive tech

Clause-②: no
Metadata-protocol: none

On a read-only package, Studio's flow connection inspector disabled every control (From, To, the branch pickers, Label, Condition, Default branch, Type, Remove connection) and gave no reason anywhere: no tooltip, no accessible description, and Tab skipped the whole panel. The reason Studio's Automations pillar hands every flow inspector reached it and was dropped. The connection inspector now carries the treatment the node inspector carries: the panel is a tab stop described by the reason, and hovering any disabled control in it shows the reason in a tooltip. Both inspectors draw it through one shared wrapper. A host that passes no reason renders exactly as before.
