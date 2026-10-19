---
'@objectstack/objectql': patch
---

fix(objectql): a formula reading a field its reference's target does not declare no longer makes the other formulas reading through the same reference read null

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes, and nothing stored, is added, removed or renamed. A valid formula that read null beside a misspelt sibling now reads its value; no spec key, export, option, object definition or stored shape changes, so there is nothing for `objectstack migrate meta` to rewrite. -->

The formula read loads, once per page, every column the object's formulas read through each reference. When one formula named a field the target does not declare, the whole reference was answered as undeclared. Every formula reading through it then read `null` and reported the other formula's field.

- The undeclared fields are left out of that shared read and judged for each formula on its own.
- A formula that names one reads `null`, with a fault report naming only its own undeclared fields.
- A formula that reads only declared fields through the same reference gets the value it gets when read alone (`?fields=`).

What to do. Nothing. A formula that read `null` this way now reads its value. To find the formula at fault, re-save the object: the save door refuses the misspelt read and names the field.
