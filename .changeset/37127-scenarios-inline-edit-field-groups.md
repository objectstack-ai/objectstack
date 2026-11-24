---
'@objectstack/scenarios': patch
---

fix(scenarios): the `records-forms.master-detail-inline-edit` tag credits a child its master's field group places, and no longer credits `inlineEdit: true`

Clause-②: no
Metadata-protocol: none

The tag now asks the same placement test the runtime's entry form uses: a master-detail child is edited inline on its master when a field group of the master names it (`fieldGroups[].relatedList`, the child object or `object.field`) and the FK is one a group may place. A build that inlines its lines that way, with no `inlineEdit` key, now passes the tag. A declared form factor, `inlineEdit: 'grid'` or `'form'`, is still credited. The retired `inlineEdit: true` alone credits nothing: it no longer places a child in the master's form.
