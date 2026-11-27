---
'@objectstack/scenarios': patch
---

fix(scenarios): the citation grader accepts a multi-word object named as words in a source line ("Source: Invoice Line")

Clause-②: no
Metadata-protocol: none

`citationLabels` now labels each namespaced object by its card name and, when that name has more than one word, by the words themselves (`invoice_line` → `invoice line`, `expense_claim` → `expense claim`). A reply that names the object as the user reads it, "Source: Invoice Line" or "Source: Expense Claim", is graded cited. Before this change only a one-word object could be cited that way. The match stays where it was: case-insensitive, inside a source line only. A line naming another object, or the words in the reply's prose, still cite nothing. The gallery export regrades with the same labels, so a recording graded by this version exports as before.
