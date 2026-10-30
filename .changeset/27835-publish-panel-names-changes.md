---
'@object-ui/app-shell': patch
---

feat(studio): the Pending changes panel names each change in words — a property by its form label, each validation rule and field group by its label, a view by the settings that changed

Clause-②: no
Metadata-protocol: none

In the Pending changes panel (Studio's publish review and the console's draft preview), an item's drill-in used to list what changed as raw keys: `+ label + name + sharingModel` for a new object, `+ config + isDefault + viewKind` for a new view, `+ fieldGroups + validations` for an object edit, with no word for which rule moved.

- **Properties by their label.** Each property reads as the label its item type's authoring form gives it, the same row the inspector shows: `Sharing Model`, `Field Groups`, `Validations`. The machine key follows only where the label does not already spell it. A property the form has no row for still reads as its key. A changed field's properties read the same way (`· Label, Required`).
- **Rules and groups by name.** An object's `validations` and `fieldGroups` list each entry publishing adds, changes or removes under their row, led by the entry's label with its name beside it, the way a flow already names its nodes. A changed field group names what differs by its declared sub-row labels.
- **Views by their settings.** A view is compared inside its body, so a view edit names `Columns` or `Filter` instead of one `config` key, and a new view lists the settings it includes.

Flow node rows are unchanged. The labels are the spec's English form labels in every locale, as most of the inspector shows them.
