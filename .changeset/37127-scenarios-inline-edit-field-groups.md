---
'@objectstack/scenarios': patch
---

fix(scenarios): the `records-forms.master-detail-inline-edit` tag credits a child its master's field group places, and no longer credits `inlineEdit` alone

Clause-②: no
Metadata-protocol: none

The tag now asks the same placement test the runtime's entry form uses: a master-detail child is edited inline on its master when a field group of the master names it (`fieldGroups[].relatedList`, the child object or `object.field`) and the FK is one a group may place. A build that inlines its lines that way, with no `inlineEdit` key, now passes the tag. `inlineEdit` alone credits nothing, whatever its value (`true`, `'grid'`, `'form'`): it does not place a child in the master's form, it only picks the form factor of a child a group places.
