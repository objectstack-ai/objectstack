---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): the flow Problems list says what the publish will refuse, and a blank expression reads "This value needs an expression"

Clause-②: no
Metadata-protocol: none

On the Studio's Automations page, a flow's Problems list judged only the canvas structure, so an Update Records value written as an expression and left blank showed a refusal under the value while Problems said "No problems — this flow is structurally valid", and Publish then refused the flow.

The Problems list now reads the verdict the pending draft's read already carries, the one the step inspectors read and the one Publish enforces, so a value the publish refuses is listed, located by the server's own words naming the step and the field. The value cell and the Problems row say the same thing, in business words: "This value needs an expression. Write one, or switch the value back to text." Any other refusal is shown as before.
