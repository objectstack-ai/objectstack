---
'@objectstack/objectql': patch
---

fix(objectql): a validation rule reading a field its reference's target does not declare no longer refuses every write through the other rules reading the same reference

Clause-②: no

A write loads, once per page, every column the object's validation rules read through each reference. When one rule named a field the target does not declare, the whole reference was answered as undeclared. Every rule reading through it then had no verdict and refused the write, each naming the other rule's field.

- The undeclared fields are left out of that shared read and judged for each rule on its own.
- A rule that names one has no verdict and refuses the write, naming only its own undeclared fields.
- A rule that reads only declared fields through the same reference gives the verdict it gives alone: it admits what it admits alone, and refuses with its own message.
- The related read keeps its authority and its bound; an undeclared field never enters it.

What to do. Nothing. To find the rule at fault, re-save the object: the save door refuses the misspelt read and names the field.
