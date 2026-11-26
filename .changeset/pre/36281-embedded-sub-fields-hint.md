---
'@objectstack/lint': patch
---

fix(lint): the `field/embedded-sub-fields` fix names the field group that inlines the child

Clause-②: no
Metadata-protocol: none

The rule's fix line told the author to make the typed list a child object and that `inlineEdit: 'grid'` edits it inline. A child is inlined in its parent's form only when a field group of the parent names it in `relatedList`; the FK's `inlineEdit` picks grid or form, nothing more. An author who followed the old line got a child shown as a tab, with no lines on the parent's form. The fix now reads: make the typed list a child object whose `master_detail` field points back here, name it in a `fieldGroups[].relatedList` here (`inlineEdit` only picks how rows are edited), and remove the key. When the rule fires, its id, severity and path are unchanged.
